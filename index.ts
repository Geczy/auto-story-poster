import * as fs from "node:fs";
import * as path from "node:path";
import axios from "axios";
import bodyParser from "body-parser";
import express from "express";
import {
	IgApiClient,
	IgLoginRequiredError,
	IgLoginTwoFactorRequiredError,
} from "instagram-private-api";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { StringSession } from "telegram/sessions";
import { TOTP } from "totp-generator";

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

if (
	!process.env.TELEGRAM_API_ID ||
	!process.env.TELEGRAM_API_HASH ||
	!process.env.TELEGRAM_STRING_SESSION ||
	!process.env.IG_USERNAME ||
	!process.env.IG_PASSWORD
) {
	console.error("Please provide all the required environment variables.");
	process.exit(1);
}

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION);

// Initialize Telegram Client
const client = new TelegramClient(stringSession, apiId, apiHash, {
	connectionRetries: 5,
});

await client.start({
	phoneNumber: () => {
		console.log("Please enter your number");
		return new Promise(() => "");
	},
	password: () => {
		console.log("Please enter your password");
		return new Promise(() => "");
	},
	phoneCode: () => {
		console.log("Please enter the code you received");
		return new Promise(() => "");
	},
	onError: (err) => console.log(err),
});

function fakeSave(data: object, path: string) {
	fs.writeFileSync(path, JSON.stringify(data));
	return data;
}

function fakeExists(path: string) {
	return fs.existsSync(path);
}

function fakeLoad(path: string) {
	if (fakeExists(path)) {
		const data = fs.readFileSync(path, "utf8");
		return JSON.parse(data);
	}
	return null;
}

const igStateFilePath = "./ig_state.json";
const ig = new IgApiClient();

async function loginToIg() {
	if (!process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
		console.error("Please provide all the required environment variables.");
		return;
	}

	ig.state.generateDevice(process.env.IG_USERNAME);

	ig.request.end$.subscribe(async () => {
		const serialized = await ig.state.serialize();
		serialized.constants = undefined; // this deletes the version info, so you'll always use the version provided by the library
		fakeSave(serialized, igStateFilePath);
	});
	if (fakeExists(igStateFilePath)) {
		console.log("Found existing instagram state file, loading...");
		await ig.state.deserialize(fakeLoad(igStateFilePath));
	} else {
		console.log("Manually logging in to Instagram");
		try {
			await ig.simulate.preLoginFlow();
			await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
		} catch (err) {
			if (err instanceof IgLoginTwoFactorRequiredError) {
				if (!process.env.IG_TOTP) {
					console.error(
						"Please provide the TOTP secret in the environment variable IG_TOTP.",
					);
					return;
				}

				const { username, totp_two_factor_on, two_factor_identifier } =
					err.response.body.two_factor_info;
				const verificationMethod = totp_two_factor_on ? "0" : "1";
				const code = TOTP.generate(process.env.IG_TOTP, { digits: 6 });
				await ig.account.twoFactorLogin({
					username,
					verificationCode: code.otp,
					twoFactorIdentifier: two_factor_identifier,
					verificationMethod, // '1' = SMS (default), '0' = TOTP (google auth for example)
					trustThisDevice: "1", // Can be omitted as '1' is used by default
				});
			}
		} finally {
			process.nextTick(async () => await ig.simulate.postLoginFlow());
		}
	}
}

async function getStoryUrl() {
	try {
		await ig.account.currentUser();
	} catch (e) {
		if (e instanceof IgLoginRequiredError) {
			console.log("Not logged in to IG");
			return;
		}
	}

	if (!process.env.IG_USERNAME) {
		console.error("Please provide the IG_USERNAME environment variable.");
		return;
	}

	try {
		const targetUser = await ig.user.searchExact(process.env.IG_USERNAME); // getting exact user by login
		const items = await ig.feed.userStory(targetUser.pk).items();
		if (items.length === 0) {
			console.log("No stories found");
			return;
		}

		return items[0].image_versions2.candidates?.[0]?.url;
	} catch (e) {
		console.error(e);
	}
}

// Endpoint for healthcheck
app.get("/", (req, res) => {
	res.send("Server is running");
});

// Endpoint to handle Instagram Webhook
app.post("/webhook", async (req, res) => {
	const { body } = req;

	// Check if the webhook is for a new story
	if (body?.entry?.[0].changes) {
		const changes = body.entry[0].changes;
		for (const change of changes) {
			if (change.field === "story") {
				const storyUrl = change.value.media_url;
				await repostToTelegram(storyUrl);
			}
		}
	}

	res.sendStatus(200);
});

async function downloadFile(url: string, filePath: string) {
	const response = await axios({
		url,
		method: "GET",
		responseType: "stream",
	});
	return new Promise((resolve, reject) => {
		const writer = fs.createWriteStream(filePath);
		response.data.pipe(writer);
		let error: Error | null = null;
		writer.on("error", (err) => {
			error = err;
			writer.close();
			reject(err);
		});
		writer.on("close", () => {
			if (!error) {
				resolve(true);
			}
		});
	});
}

async function getExistingTelegramStories() {
	const stories = await client.invoke(
		new Api.stories.GetPeerStories({ peer: "me" }),
	);

	// console.log(stories.stories.stories[0].toJSON().media);

	return stories;
}

async function repostToTelegram(storyUrl: string) {
	try {
		const canSendStory = await client.invoke(
			new Api.stories.CanSendStory({
				peer: "me",
			}),
		);

		if (!canSendStory) {
			console.error("The account is not allowed to send stories right now.");
			return;
		}

		const filePath = path.join(__dirname, "tempStory.jpg");
		console.log(`Downloading story from URL: ${storyUrl}`);
		await downloadFile(storyUrl, filePath);
		console.log(`File downloaded to: ${filePath}`);

		const fileStats = fs.statSync(filePath);
		const customFile = new CustomFile(
			path.basename(filePath),
			fileStats.size,
			filePath,
		);

		console.log("Uploading file to Telegram...");

		const uploadedFile = await client.uploadFile({
			file: customFile,
			workers: 1,
		});

		const media = new Api.InputMediaUploadedPhoto({
			file: uploadedFile,
		});

		console.log("Sending story to Telegram...");

		const story = await client.invoke(
			new Api.stories.SendStory({
				peer: "me",
				media: media,
				privacyRules: [new Api.InputPrivacyValueAllowAll()],
			}),
		);

		fs.unlinkSync(filePath); // Clean up the temporary file
		console.log("File deleted after sending.");

		return story;
	} catch (error) {
		console.error("Error reposting to Telegram", error);
	}
}

app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});

// await loginToIg();
// const url = await getStoryUrl();
// if (url) {
// 	await repostToTelegram(url);
// }
