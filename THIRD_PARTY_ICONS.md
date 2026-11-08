# Third-party icons

Wherever Beluga shows one of your computers (Settings › Your Computers, the sidebar, Runs on, a
computer's page), it draws what kind of computer it is with its maker's mark where we ship one. The
marks are in `packages/mac/src/machines/icons/brands/`, each file exactly as it came:

- The one-colour marks come from [Simple Icons](https://simpleicons.org) 16.37.0 (the SVG files are
  CC0-1.0). The app draws each file as a mask in its brand colour and never changes it.
- AWS and Microsoft Azure come from their owners' own icon sets, in full colour, and are drawn as
  images, never recoloured or redrawn.

The marks themselves are trademarks of their owners. We use them only to say which service or
hardware a computer of yours runs on, as their guidelines allow, and never to suggest the owner
endorses Beluga.

| File | Mark | Owner | Source | Guidelines |
| --- | --- | --- | --- | --- |
| `aws.svg` | AWS (the AWS Cloud logo) | Amazon.com, Inc. or its affiliates | AWS Architecture Icons, release 07312026 (`Architecture-Group-Icons/AWS-Cloud-logo_32.svg`), https://aws.amazon.com/architecture/icons/ | https://aws.amazon.com/architecture/icons/ and https://aws.amazon.com/trademark-guidelines/ |
| `azure.svg` | Microsoft Azure | Microsoft Corporation | Azure Public Service Icons V25 (`Icons/other/10018-icon-service-Azure-A.svg`), https://learn.microsoft.com/azure/architecture/icons/ | https://learn.microsoft.com/azure/architecture/icons/ (its Terms of Use and FAQ ship in the icon set) |
| `googlecloud.svg` | Google Cloud | Google LLC | https://cloud.google.com | https://about.google/brand-resource-center/ |
| `digitalocean.svg` | DigitalOcean | DigitalOcean, LLC | https://www.digitalocean.com/press/ | https://www.digitalocean.com/press/ |
| `hetzner.svg` | Hetzner | Hetzner Online GmbH | https://www.hetzner.com | https://www.hetzner.com |
| `raspberrypi.svg` | Raspberry Pi | Raspberry Pi Ltd | https://www.raspberrypi.org/trademark-rules | https://www.raspberrypi.org/trademark-rules |
| `docker.svg` | Docker | Docker, Inc. | https://www.docker.com/company/newsroom/media-resources | https://www.docker.com/company/newsroom/media-resources |
| `podman.svg` | Podman | The Podman project | https://podman.io | https://podman.io |

Apple hardware (Mac mini, MacBook, Mac Studio, iMac) always gets a plain desktop or laptop
glyph, never Apple's marks.

Every other icon in the app is Beluga's own set (`packages/mac/src/components/Icon.tsx`).
