import * as fs from "node:fs";
import * as path from "node:path";
import axios from "axios";
import bodyParser from "body-parser";
import express from "express";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { StringSession } from "telegram/sessions";

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

if (
	!process.env.TELEGRAM_API_ID ||
	!process.env.TELEGRAM_API_HASH ||
	!process.env.TELEGRAM_STRING_SESSION
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

// await repostToTelegram("https://i.imgur.com/mgeJEiO.png");
