# Third-party icons

Settings › Your Computers shows what kind of computer each one is with its maker's mark where we
ship one. The marks are in `packages/mac/src/machines/icons/brands/`, each file exactly as it came
from [Simple Icons](https://simpleicons.org) 16.37.0 (the SVG files are CC0-1.0). The app draws each
file as a mask in its brand colour and never changes it.

The marks themselves are trademarks of their owners. We use them only to say which service or
hardware a computer of yours runs on, as their guidelines allow, and never to suggest the owner
endorses Beluga.

| File | Mark | Owner | Source | Guidelines |
| --- | --- | --- | --- | --- |
| `googlecloud.svg` | Google Cloud | Google LLC | https://cloud.google.com | https://about.google/brand-resource-center/ |
| `digitalocean.svg` | DigitalOcean | DigitalOcean, LLC | https://www.digitalocean.com/press/ | https://www.digitalocean.com/press/ |
| `hetzner.svg` | Hetzner | Hetzner Online GmbH | https://www.hetzner.com | https://www.hetzner.com |
| `raspberrypi.svg` | Raspberry Pi | Raspberry Pi Ltd | https://www.raspberrypi.org/trademark-rules | https://www.raspberrypi.org/trademark-rules |
| `docker.svg` | Docker | Docker, Inc. | https://www.docker.com/company/newsroom/media-resources | https://www.docker.com/company/newsroom/media-resources |
| `podman.svg` | Podman | The Podman project | https://podman.io | https://podman.io |

Not shipped yet: **AWS** and **Microsoft Azure** ask that their marks come from their own
architecture icon sets under their terms, and Simple Icons no longer carries them. Until they're
added from https://aws.amazon.com/architecture/icons/ and
https://learn.microsoft.com/azure/architecture/icons/, those computers get Beluga's own cloud
glyph. Apple hardware (Mac mini, MacBook, Mac Studio, iMac) always gets a plain desktop or laptop
glyph, never Apple's marks.

Every other icon in the app is Beluga's own set (`packages/mac/src/components/Icon.tsx`).
