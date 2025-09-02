# WhatsApp Bot using Baileys

A Node.js WhatsApp bot that saves every new number that messages you, stores contact info, and serves a vCard file via Express.

## Features

- Automatically saves every new number that messages you.
- Stores phone number and WhatsApp display name in `contacts.json`.
- Generates and updates `contacts.vcf` (vCard file) for all contacts.
- Serves `contacts.vcf` via an Express web server.
- Route `/contacts.vcf?pass=lelop` is protected by password (`lelop`).
- Designed for Railway deployment.

## Usage

1. Clone this repo and install dependencies:
   ```bash
   npm install
   ```
2. Start the bot:
   ```bash
   node bot.js
   ```
3. Open browser to `http://localhost:3000/contacts.vcf?pass=lelop` to download the vCard.

## Deployment

Deploy on [Railway](https://railway.app/) with the start command:
```
node bot.js
```
