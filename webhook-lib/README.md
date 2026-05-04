# webhook-lib

TypeScript client for registering webhook subscribers and emitting events against a webhook-infra–compatible API (`createWebhooks`). Also includes optional receive-side placeholders (`WebhookProcessor`, `validateSignature`). Builds to **CommonJS** and **ESM** with declaration files.

## Requirements

- Node.js 18+

## Installation

From the monorepo root (path may vary):

```bash
cd webhook-lib
npm install
npm run build
```

Link into another package locally:

```bash
npm link
# in your app directory:
npm link webhook-lib
```

Or depend on the folder via `file:` in the consumer’s `package.json`:

```json
{
  "dependencies": {
    "webhook-lib": "file:../webhook-lib"
  }
}
```

## Usage

**ESM (`import`)**

```ts
import { createWebhooks } from 'webhook-lib';

const webhooks = createWebhooks({
  endpoint: process.env.WEBHOOK_BASE_URL!,
  key: process.env.WEBHOOK_API_KEY!,
});

await webhooks.register('order.created', 'https://example.com/hook');
await webhooks.emit('order.created', { orderId: '42' });
```

**CommonJS (`require`)**

```js
const { createWebhooks } = require('webhook-lib');

async function main() {
  const webhooks = createWebhooks({ endpoint: 'http://127.0.0.1:3000', key: process.env.WEBHOOK_API_KEY });
  await webhooks.register('order.created', 'https://example.com/hook');
}
void main();
```

Optional receive-side placeholders: `WebhookProcessor`, `validateSignature` (see type definitions).

## Scripts

| Script    | Description                          |
| --------- | ------------------------------------ |
| `npm run build` | Produce `dist/` via **tsup** (CJS + ESM + `.d.ts`) |
| `npm run check` | Typecheck only (`tsc --noEmit`)      |

After `build`, consumers resolve `main` / `module` / `types` and the conditional `exports` map for `import` vs `require`.

## Development notes

- Source lives in `src/index.ts`.
- `tsconfig.json` enables declarations and source maps for the editor; **tsup** emits the published `dist/` output.
- `validateSignature` and `WebhookProcessor.process` are intentional placeholders—implement signing and routing for production.
