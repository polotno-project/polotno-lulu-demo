# Lulu API demo with Polotno

A paperback cover editor built with Polotno SDK. It sizes the full wrap (back, spine, front, bleed) for the page count, exports the cover PDF and checks it with the Lulu Print API.

> **You need a Polotno API key to run this.** The code in this repo is MIT, but it runs on [Polotno SDK](https://polotno.com), which is commercial. Get a trial key in your [Polotno dashboard](https://polotno.com/cabinet) to try it (trial keys show a "Powered by Polotno" credit); shipping it in a product needs a [paid Polotno license](https://polotno.com/sdk/pricing).

Try it live: [polotno.com/sdk/product/integrations/lulu](https://polotno.com/sdk/product/integrations/lulu)

## How it works

1. The editor is sized to Lulu's print spec, so the export matches what Lulu expects.
2. Pressing the button in the **Lulu** tab exports the print file and posts it to the server.
3. The server asks Lulu for the cover size it expects, uploads the PDF and polls Lulu's cover validation until it passes or fails.
4. The result shows what came back, plus the exact requests sent, ready to copy into your backend.

## Run it

You need Node 20+, pnpm, a Polotno API key (a trial key from [polotno.com/cabinet](https://polotno.com/cabinet) works for trying it) and Lulu API credentials.

```bash
cd server
cp .env.example .env   # add your Lulu credentials
node --env-file=.env server.mjs
```

```bash
cd web
cp .env.example .env   # add your Polotno key
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The credentials stay on the server.

Lulu downloads the print file from this server, so to run it locally expose the server with a tunnel (for example `cloudflared tunnel --url http://localhost:8787`) and set `PUBLIC_URL` to the tunnel address.

## Where things are

- `web/src/index.jsx`: the editor, sized to the product
- `web/src/lulu-section.jsx`: the Lulu tab and the result dialog
- `server/server.mjs`: the Lulu API calls

## More providers

The same pattern for other print APIs: [polotno-project on GitHub](https://github.com/polotno-project?q=demo) (Printful, Printify, Teemill, Fourthwall, Spreadconnect, Scalable Press, Lulu, Peecho, Gelato, Prodigi).

## License

The code in this repository is MIT. Polotno SDK itself is not: it needs a Polotno API key, and production use needs a [paid license](https://polotno.com/sdk/pricing).
