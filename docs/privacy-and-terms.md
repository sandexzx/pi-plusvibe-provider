# Privacy and service terms

[← README](../README.md) · [Русский](privacy-and-terms.ru.md)

Service terms can change. This document describes the integration; it does not replace the operator’s current terms or legal advice.

## Status and service terms

This is an unofficial, independent client extension for PlusVibeAPI. It is not affiliated with,
endorsed by, or supported by the PlusVibeAPI operator. "PlusVibeAPI" and "PlusVibe" are used only
to identify the service this extension integrates with. Any rights in these names remain with
their respective holders.

Each user must obtain and use their own API key. This package does not include a shared key, does
not operate a proxy, and does not provide access through the maintainer's account.

Use of PlusVibeAPI is subject to the operator's
[terms of service](https://plusvibeapi.ru/legal/terms). The MIT license applies to this project's
code; it does not grant rights to the service, to operator-owned materials, or to third-party
model outputs.

The operator's terms prohibit sharing or reselling access through its keys without a separate
written agreement. Do not bypass access controls or service limits.

## Data and privacy

Requests are sent from your machine to the configured API gateway. When you use PlusVibeAPI, the
operator forwards request content to model providers outside Russia, including providers in the
USA, China and the EU, as described in its terms.

Request content may include prompts, conversation history, source code, file contents, images and
tool results supplied by Pi. Review the content before you send it.

The operator's terms prohibit submitting personal data. Do not submit personal data about yourself
or about other people. This extension does not automatically detect or anonymize personal data.
Consent alone does not override the operator's prohibition.

Do not submit credentials, confidential information or other content unless you are authorized to
disclose it to the gateway and to the relevant model providers. Where applicable, users and
organizations must assess their own data-protection, localization and cross-border-transfer
obligations (in particular art. 12 and part 5 of art. 18 of Federal Law No. 152-FZ).

This extension does not operate a server and does not collect telemetry for its maintainer. It
makes network requests for model metadata and, unless disabled, for exchange rates. Those services
can receive ordinary connection metadata, such as your IP address. This statement describes this
extension only, not every network request of the Pi process as a whole.

Your API key is sent to the configured gateway. Set `PLUSVIBE_BASE_URL` only to an endpoint you
trust: another address can receive both the key and the request content. Do not post API keys or
unredacted logs in public issues.
