# auto-story-poster

## Usage

1. `bun i` && `bun index.ts`

## Credentials

1. TELEGRAM_API_ID and TELEGRAM_API_HASH are from <https://my.telegram.org/apps>
2. TELEGRAM_STRING_SESSION: run `bun getSession.ts`
3. IG_TOTP: Instagram Two-Factor secret code. Optional if you have 2FA enabled. If you don't have 2FA enabled, you can skip this step

  ```
  # If your OTP auth url looks like: otpauth://totp/Username%3A%20my_username?secret=AWPODKASPODK123&digits=6&period=30
  # The secret is `AWPODKASPODK123`

  So save the secret in the .env file as IG_TOTP=AWPODKASPODK123
  ```
