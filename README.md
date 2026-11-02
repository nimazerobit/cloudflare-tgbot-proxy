# Cloudflare Telegram Bot Proxy

<p align="center">  
A lightweight reverse proxy for the Telegram Bot API based on Cloudflare Workers.
</p>

<p align="center">  
<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/nimazerobit/cloudflare-tgbot-proxy">  
<img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers">  
</a>  
</p>

<p align="center">  
<img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare" alt="Cloudflare Workers">  
<img src="https://img.shields.io/badge/Dependencies-None-success?style=flat-square" alt="Zero Dependencies">  
<img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License">  
</p>

## ✨ Features

-   🌍 **Bypass Regional Blocks** – Route Telegram API requests through Cloudflare.
-   🔒 **Token Protection** – Optionally restrict access to authorized bot tokens.
-   🔄 **Webhook Forwarding** – Forward Telegram updates to your own backend.
-   🌐 **CORS Support** – Handles preflight requests and security headers.

## 🚀 Quick Deployment

No Node.js, Git, or terminal required!

### Step 1. Create a Cloudflare Worker

1.  Open the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  Go to **Workers & Pages**.
3.  Click **Create** → **Create Worker**.
4.  Choose a name, such as `telegram-proxy`.
5.  Click **Deploy**.

### Step 2. Add the Code

1.  Open your new Worker.    
2.  Click **Edit Code**.
3.  Replace the default code with the complete contents of `index.js`.
4.  Click **Save and Deploy**.

### Step 3. Configure (Optional)

Go to **Settings → Variables and Secrets** and add these environment variables if needed:

| Variable | Description |
|---|---|
| `ALLOWED_TOKENS` | Comma-separated list of authorized bot tokens. |
| `WEBHOOK_TARGET_URL` | Your backend URL for receiving Telegram updates. |
| `ALLOWED_WEBHOOK_IPS` | Additional IP addresses or CIDR ranges allowed to access `/webhook`. |

> [!NOTE]
> If `ALLOWED_TOKENS` is not configured, all bot tokens are allowed. Configure it if you want to restrict access.

### Step 4. Test Your Worker

Open your Worker URL in a browser:

```
https://YOUR-WORKER.workers.dev/
```

Expected response:

```json
{
  "status": "ok"
}
```

That's it! Your proxy is ready.

## 📡 How to Use

Simply replace `api.telegram.org` with your Worker URL.

**Original Telegram API:**

```
https://api.telegram.org/bot<TOKEN>/sendMessage
```

**Using your Cloudflare Worker:**

```
https://YOUR-WORKER.workers.dev/bot<TOKEN>/sendMessage
```

No changes to your Telegram API methods or request parameters are required.

## 🔔 Webhook Setup

To receive Telegram updates through your Worker, set your webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://YOUR-WORKER.workers.dev/webhook"
```

If `WEBHOOK_TARGET_URL` is configured, the Worker forwards incoming updates to your backend.

The proxy also:

-   Checks Telegram's official IPv4 address ranges.
-   Preserves the Telegram webhook secret header.
-   Forwards the original request IP through `X-Forwarded-For`.

**Optional:** You can override the webhook destination using the `target` query parameter:

```
https://YOUR-WORKER.workers.dev/webhook?target=https://example.com/hook
```

Only use trusted destination URLs when enabling dynamic webhook targets.

## 🧩 Framework Examples

You can use this proxy with popular Telegram bot frameworks.

**Python – python-telegram-bot**

```py
from telegram.ext import ApplicationBuilder
from telegram.request import HTTPXRequest

request = HTTPXRequest(
    base_url="https://YOUR-WORKER.workers.dev/bot"
)

app = (
    ApplicationBuilder()
    .token("YOUR_BOT_TOKEN")
    .request(request)
    .build()
)
```

**Python – aiogram**

```py
from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession

session = AiohttpSession(
    api="https://YOUR-WORKER.workers.dev/bot{token}/{method}"
)

bot = Bot(token="YOUR_BOT_TOKEN", session=session)
```

**Node.js – grammY**

```js
import { Bot } from "grammy";

const bot = new Bot("YOUR_BOT_TOKEN", {
  client: {
    apiRoot: "https://YOUR-WORKER.workers.dev",
  },
});
```

**Node.js – Telegraf**

```js
import { Telegraf } from "telegraf";

const bot = new Telegraf("YOUR_BOT_TOKEN", {
  telegram: {
    apiRoot: "https://YOUR-WORKER.workers.dev",
  },
});
```

## 💻 Deploy with Wrangler (Optional)

Prefer using the terminal?

```bash
git clone https://github.com/nimazerobit/cloudflare-tgbot-proxy.git
cd cloudflare-tgbot-proxy
npx wrangler deploy
```

For local development:

```bash
npx wrangler dev
```

Run tests:

```bash
npm test
```

## 🔐 Security Notes

-   Keep your bot tokens private.
-   Use `ALLOWED_TOKENS` to restrict proxy access.
-   Configure `WEBHOOK_TARGET_URL` to control where updates are forwarded.
-   Use HTTPS for your backend.
-   Be careful when using dynamic webhook destinations.

## 📄 License

Released under the MIT License.\
Feel free to use, modify, and distribute this project.