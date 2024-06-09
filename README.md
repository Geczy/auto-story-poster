# auto-story-poster

1. TELEGRAM_API_ID and TELEGRAM_API_HASH are from https://my.telegram.org/apps
2. TELEGRAM_STRING_SESSION:

```js
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "readline";

const apiId = 123456;
const apiHash = "123456abcdfg";
const stringSession = new StringSession(""); // fill this later with the value from session.save()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  console.log("Loading interactive example...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.start({
    phoneNumber: async () =>
      new Promise((resolve) =>
        rl.question("Please enter your number: ", resolve)
      ),
    password: async () =>
      new Promise((resolve) =>
        rl.question("Please enter your password: ", resolve)
      ),
    phoneCode: async () =>
      new Promise((resolve) =>
        rl.question("Please enter the code you received: ", resolve)
      ),
    onError: (err) => console.log(err),
  });
  console.log("You should now be connected.");
  console.log(client.session.save()); // Save this string to avoid logging in again
})();
```

3. IG_TOTP: Instagram Two-Factor secret code

```
# If your OTP auth url looks like: otpauth://totp/Username%3A%20my_username?secret=AWPODKASPODK123&digits=6&period=30
# The secret is `AWPODKASPODK123`

So save the secret in the .env file as IG_TOTP=AWPODKASPODK123
```
