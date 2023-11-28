---
related:
- "[[Web]]"
- "[[Future 2040]]"
created_at: "21-11-2022 16:31"
tags: Research
alias: W5
---


# Vision
---
- Lead by the open source platform TBD (business unit of Block Inc.) and coined by jack dorcey (ex Twitter CEO)
- **Vision: bring decentralized identity ([[Self-Sovereign Identity]] reference other Article) and data storage (Decentralized Web Nodes) to web applications which are fully owned by the user without relying on third-parties**
- really decentralized: using [[Bitcoin]] which is not primarily backed bei major Players but by it's community
- better UI/UX: Easier on and off-ramps for the average person without the need of centralized exchanges
- Negotiate Trust/Risk: there cant be a trust less platform with Fiat as an interface, exchanges should decide which verified credentials are required

# Technical Implementation
---
- Web5 implementing their own [[Self-Sovereign Identity]] Stack and is based on well defined standards and is not just a marketing gimmick
![[Pasted image 20221229094602.png#invert|600]]
- Layer 1: Web5 is using the Identity Solution ION which is based on Bitcoin managing your Decentralized IDentifiers 
- All other Layers are implemented by TBD:
	- Layer 2: [[Web5#Dezentral Web Nodes / Identity Hubs|Decentralized Web Nodes]] aka Identity Hub for enabling Decentralized Web Applications/Protocols + [Web5 Wallet](https://github.com/TBD54566975/web5-wallet-browser)
	- Layer 3: [SSI Service](https://github.com/TBD54566975/ssi-service)  whole Verifiable Credential System
	- Layer 4: tbDEX liquidity Protocol leveraging Web5: Financial system without trusted central authority where providers (Participating Financial Institutions) can plug into the system and users have easy on and off-ramps (fiat <-> crypto) with settlement on [[Bitcoin Lightning]] [[tbDEX Whitepaper.pdf]]
- early prototyping (and early stage of [dwn spec](https://identity.foundation/decentralized-web-node/spec/)), but under active development

## Dezentral Web Nodes / Identity Hubs
![[Pasted image 20230102143745.png]]
- own permissioned cloud storage
- [TBD SDK implementation Github](https://github.com/TBD54566975/dwn-sdk-js) + [TBD RESTful DWN](https://github.com/TBD54566975/dwn-relay)
- Lookup on DID Document under [Service Endpoints](https://identity.foundation/decentralized-web-node/spec/#service-endpoints)
- Send multiple messages in one request to DWN
### Interfaces: (WIP)
- It stores data in Collections (Schemas use-case specific) on Blockstore Level
- Interact with them through use-case specific Protocols if you have the right Permissions
- Hooks/Subscription to DWN to register callbacks on certain events
- Synchronization of multiple DWN

## ION - Identity Layer
---
- Identity Provider implementing Sidetree Protocol build on Bitcoin as Second Layer similar to [[Bitcoin Lightning]] Network
- Developed by Microsoft and the Decentralized Identity Foundation (open source)
- [Good Resource](https://www.youtube.com/watch?v=ZIvYah2rmuQ)

### Vision - Anforderungen
- Kontrolle über eigene Identität
- Datenschutz als grundlegendes Konzept
- Identitätsnachweise als Basis für Vertrauen
- Offene und interoperable Standards
- Weltweite Skalierung
- Mainstream Nutzung developed by Microsoft

### Architecture
[[image (4).png|Also an Overview Image]]
Better Overview:
![[Pasted image 20221215085839.png]]
### Side Tree Protocol
Enables Decentralized Identification
[Sidetree Spec](https://identity.foundation/sidetree/spec/)
Txn Writer: Anchors DID on an immutable, append only, public storage (like Blockchain)
DID references DID Documents and permissioned storage on IPFS for example
Other nodes observer blockchain to sync there state

Ultimately:
	Blockchain: for storing links (most secure, verifiable and permissionless)
	Identity Hubs (IPFS): for storing actual documents, credentials... (storage, permissioned)

# Use Case
---
- tbDEX liquidity protocol with Bitcoin Lightning -> accessibility even helps people in developing countries with limited access to banks
- Personal Data Storage called Decentralized Web Nodes
- [[Self-Sovereign Identity#Use Cases]]: P2P Direct Communication (DIDComm) + Verifiable Credentials -> Better UX, Security, Privacy and Censorship resistance:

# Current Problems
---
- [[Self-Sovereign Identity#Problems]]
- ==how good is Lightning really?==
- Limited Smart Contracts on Bitcoin (important for tbDEX)
- ION unbenutzbar (Open Source Code nicht vertrauenswürdig, Critical Libraries + weird request to servers in russia) -> using Microsoft inhouse Solution

## Is Ethereum > Bitcoin or is Bitcoin sufficient for SSI?
|          | Pro                                 | Con                           |
| -------- | ----------------------------------- | ----------------------------- |
| Bitcoin  | Secure PoW + Really Decentralized       | Turing incomplete Bitcoin Script |
| Ethereum | **Secure? PoS** + Great Smart Contracts | **Not really decentralized?**      |

# Participants/Organizations
---
- **TBD Web5 from Block Inc. using specifications from DIF and W3C and making own implementations on top of ION**
- Decentralized Identity Foundation: Building Specifications [DWN](https://identity.foundation/decentralized-web-node/spec/)/Identity Hub and first [Implementations](https://github.com/decentralized-identity?type=source)
- [W3C Credentials Community Group](https://w3c-ccg.github.io/) (building shit + specifications [DID-Core](https://www.w3.org/TR/did-core/))
- ION - DID implementation after W3C standards

# Resources
---
- [Great Video on SSI](https://www.youtube.com/watch?v=Jcfy9wd5bZI)
- [[_Decentralized Web Platform - Public 1.pdf|Pitch Deck]]
- [Great Github Overview](https://github.com/TBD54566975/collaboration)
- [[tbDEX Whitepaper.pdf]]


