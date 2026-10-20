<div align="center">

# PlusVibeAPI for Pi

**Your PlusVibeAPI models, inside Pi.**

One personal API key. A live model catalog. Balance checks without leaving your session.

[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Pi extension](https://img.shields.io/badge/Pi-extension-6c5ce7?style=flat-square)](https://github.com/earendil-works/pi)

**English** · [Русский](README.ru.md)

[Quick start](#quick-start) · [Commands](#commands) · [Configuration](docs/configuration.md) · [Contributing](CONTRIBUTING.md)

</div>

---

Connect [Pi](https://github.com/earendil-works/pi) to [PlusVibeAPI](https://plusvibeapi.ru/docs), an OpenAI-compatible gateway for Anthropic, OpenAI, Google, DeepSeek, Qwen and other model providers.

- **Choose models in Pi.** Context limits, image input and reasoning capabilities come from the provider’s catalog.
- **Keep the catalog current.** Live refresh with a bundled snapshot when catalog endpoints are unavailable.
- **Control reasoning.** Model-specific level mapping, including DeepSeek compatibility adjustments.
- **Check your balance.** `/plusvibe-balance` shows the account balance; automatic RUB → USD conversion provides cost estimates in Pi.

## Quick start

You need [Pi](https://github.com/earendil-works/pi#getting-started), Git, and your own API key from the [PlusVibeAPI dashboard](https://plusvibeapi.ru/). Keys start with `sk-pv-`.

> [!IMPORTANT]
> This is an unofficial extension, not affiliated with or supported by PlusVibeAPI. Requests go to the gateway and model providers. The operator’s terms prohibit submitting personal data. Read the [privacy and service notes](docs/privacy-and-terms.md) before use.

### 1. Install

```bash
pi install git:github.com/sandexzx/pi-plusvibe-provider
```

### 2. Connect your key

Start or restart Pi, then run:

```text
/login
```

Choose **PlusVibeAPI** and paste your key. The extension verifies it and Pi saves it in `auth.json` for future sessions.

### 3. Pick a model

Run `/model`, search for `plusvibe`, and choose a model. You can now send your first prompt.

Prefer an environment variable or a key file? See [configuration](docs/configuration.md).

## Commands

| Command | What it does |
| --- | --- |
| `/model` | Choose a model; search for `plusvibe`. |
| `/thinking` | Set the reasoning level for a supported model. |
| `/plusvibe-gateway` | Switch between the main gateway and the mirror. |
| `/plusvibe-balance` | Show your PlusVibeAPI balance and the configured exchange rate, when available. |
| `/login` | Add and verify your API key. |
| `/logout` | Remove the key saved through `/login`. |

## Good to know

- **Cannot connect, for example from abroad?** Use `/plusvibe-gateway` to switch to the mirror and back. See [gateway configuration](docs/configuration.md#gateway--mirror) for manual setup.

- **Chat models only.** Image input is available on supported models. Image generation, embeddings, video, search and speech-to-text endpoints are not integrated.
- **Costs are estimates.** PlusVibeAPI lists prices in rubles; Pi displays dollars. Conversion uses an automatically fetched exchange rate. `$0` can mean no usable rate, not free inference. Check the dashboard for actual charges.
- **A fallback catalog is not offline inference.** Model requests still need a working gateway connection and a valid key.
- **Your key stays under your control.** No shared account, built-in proxy or maintainer telemetry. See [what data is sent and where](docs/privacy-and-terms.md).

## Documentation

| Guide | Contents |
| --- | --- |
| [Configuration](docs/configuration.md) | Key sources and priority, environment variables, exchange rates, DeepSeek reasoning. |
| [Privacy and service terms](docs/privacy-and-terms.md) | Request data, external services, API-key safety and operator restrictions. |
| [Contributing](CONTRIBUTING.md) | Local setup, tests, catalog updates and source layout. |

To update this package:

```bash
pi update git:github.com/sandexzx/pi-plusvibe-provider
```

To remove it:

```bash
pi remove git:github.com/sandexzx/pi-plusvibe-provider
```

## License and credits

[MIT](LICENSE). Inspired by [pi-commandcode-provider](https://github.com/patlux/pi-commandcode-provider); see [acknowledgments](docs/acknowledgments.md).

Exchange-rate data: [cbr-xml-daily.ru](https://www.cbr-xml-daily.ru/), [Bank of Russia](https://www.cbr.ru/development/SXML/), [ExchangeRate-API](https://www.exchangerate-api.com/docs/free).
