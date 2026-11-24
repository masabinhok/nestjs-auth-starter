# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](../../security/advisories/new), not in public
issues. Include steps to reproduce and the impact you see.

You'll get an acknowledgement within a few days. Once a fix is ready, it is
released with an advisory crediting you, unless you prefer otherwise.

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.1.x | Security fixes only, until 2027-05-31 |
| 1.0.x | No: upgrade to 1.1 or 2.x |

## Scope

This starter's own code: storage, credential providers, handlers, lockout,
passkeys, configuration, Docker setup. Vulnerabilities in
`@nestjs/authentication`, `@nestjs/authorization` or other dependencies
should go to those projects; tell us too if this starter is affected.

The [security model](docs/security.md) describes what the starter defends
against and its known limits.
