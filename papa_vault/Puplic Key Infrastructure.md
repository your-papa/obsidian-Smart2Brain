---
related:
- "[[Web]]"
- "[[Cryptography]]"
created_at:  "21-12-2022 17:32"
tags: Research
alias: PKI
---

Solves Public Key exchange through a chain of Trust
Summarized: The Domain is linked to the Public Key through a trusted Certificate/[[Self-Sovereign Identity#Verifiable Credentials (Layer 3)|VC]]

# PKI: Certificate Authorities
---
Only thing you need to trust is the public key that is stored on your computer and the linked private key that identifies the Root CA
Binds Public Key of host to its domain name after checking that you really control the IP that is resolved by the [[DNS]]

## Chain of Trust
Chain reduces access to private key of Root CA -> less possible exposing that private key and make every certificate invalid
![[image (5).png]]
Nowadays the Distinguished Name (named: Authority KI, Subject KI) is a hash made over the public key (public key is identifier of CAs)

# Decentralized PKI
---
- Public Key is the service address or DID (like IP) and is therefore bind to itself
- also Domain name still needs to be mapped to that DID - **happens in the DID Document where a verifiable credential (issued from an Issuer) holds the domain**
- and Domain needs to be mapped to IP (by [[DNS]] or DDNS)

Summarized: The DID is the hashed public Key which points to a DID Document holding the Keys and communication endpoints

## Misconception: DPKI solves PKI
Self-Certifying also wrong Conception?:
![[Pasted image 20221230130848.png]]
Bad Article: (only thing that needs Blockchain according to this [article](https://www.ibm.com/blogs/blockchain/2018/06/self-sovereign-identity-why-blockchain/))
- if there are still normal domains referenced in the DID document you would still need to trust a DNS (not decentralized) to let it resolve to the right IP
	-> wouldnt be such a big use case because DNS trust > CA trust -> services would also need to be decentralized with DID-> then whole their would be no more IP that needs to be linked to the domain but the domain would itself be the IP or then DID in this case which is the public Key
Partly Answer: 
- can check link between public key and IP by testing public key against the parties private key
- To clarify: whole chain: public key <-> domain <-> ip <-> private key
- To hijack a connection in our centralized web you would need to compromise the certificate signed with your keys AND the DNS for hijacking the domain.
- Hijacking only one of them would only bring you so far:
	- For DNS: you would get an insecure connection, because attackers private key wouldnt match up with public key in certificate
	- For CA: controlling a certificate of a domain you dont own gives you nothing because nobody can connect to your service behind the actual domain because its still linked to the official IP. attacker can build no secure connection between him and the victim
	-> NO ATTACK VECTOR BUT TRUST -> SSI solves the trust problem by providing the secure link between domain and public key through DIDs (Document) aka self-certifying certificates -> the link: public key <-> domain is trustless secured -> whole chain from public key to IP fixed and trust removed because as we know every link in chain needs to be compromised
**Follow up Question: How to impede that you can not write any Domain you dont control in your DID Document? (was job of CA)**
My Answer: W3C not specifying a solution to that question. open to you on how to use serviceEndpoints
Example: [On how in my opinion SSI doesnt solve PKI](https://identity.foundation/decentralized-web-node/spec/#service-endpoints)
**Real Answer: DPKI just as cryptographically secure as PKI - still needs human trust, trusting the issuer of the VC or the Certificate of the CA's**
My next Idea: But when everything is decentralized, even the issuing of the VC's then we would have a trust less system right?

# PKI vs DPKI
---
![[PKI 2022-12-22 17.04.14.excalidraw|1000]]

# Resources
---
- [Good Video on PKI](https://www.youtube.com/watch?v=CM3uK4J_onw)
- [Good Video on DPKI/DIDs](https://www.youtube.com/watch?v=SHuRRaOBMz4)
