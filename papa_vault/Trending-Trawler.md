---
related:
  - "[[HWR]]"
  - "[[Projekt]]"
created_at: 27-01-2023 15:58
tags: Project/Done
---
![[Pasted image 20230315164851.png|300]]

### [Todo](https://www.notion.so/fd14cbcb288245adbb2af6ad04834267?v=e4ff7861c94f4fdebee25dc279fb4b2e) + [[Archived Todo]] under Trending Trawler
### [Github](https://github.com/Trending-Trawler?type=source)
### Präsentationen
- [[Zwischenpräsentation.pdf]]
- [[endpräsi.pdf]]
- [[Paper_IT21B_1.pdf]]

# Vision
---
Automatic content creation:
- Short video of a Reddit thread read out in front of background Gameplay

# Architecture
---
![[Pasted image 20230315155835.png]]
Google TTS -> TikTok TTS
The architecture diagram provides a rough overview of the communication paths within our application. The user has the option to access the web app through various devices, such as laptops, tablets or smartphones. Thanks to responsive web design, the React frontend supports an optimal display on all devices, enabling comfortable and user-friendly use. Once the user performs an action, it is sent via HTTP request from the frontend to the backend. The backend acts as a REST API and provides endpoints that can be accessed by the web app.

We use the FAST API framework to handle requests and define the structure of the backend. In particular, it is ensured that the backend is clearly structured and the communication paths can be traced. To achieve this, the functionality of the backend is presented in individual sections, each of which takes on specific tasks. One example of this is the **Reddit Scraper**, which copies and processes desired threads from Reddit. Here, the **Reddit API** is used as an external component to access Reddit data. The copied messages are processed by the processing tools and used to create a complete video.

To achieve a visually appealing and informative video presentation, various components are combined into a complete work. On the one hand, a voice is generated using the **TikTok Text-to-Speech API**, which reads the contents of the Reddit messages to the user. On the other hand, the **Imagegenerator** inserts screenshots of the Reddit messages to visualize them in the video. The complete video with all components such as background video, voice-over and screenshots of the messages is generated and made available to the user on request.

To meet additional performance requirements, endpoints can be easily added that can influence factors such as the voice-over. This allows us to continuously improve the web app and tailor it to the needs of our users.

# UML
---
## Aktivitätsdiagramm
![[Pasted image 20230315155945.png]]

## Sequenzdiagramm
![[Pasted image 20230315155958.png]]

# Marketing Teaser
---
Trending-Trawler: Automatisiert virale Videos für Social Media generieren

Wenn Sie mal auf TikTok oder Instagram Reels unterwegs waren haben Sie sich bestimmt mal gefragt wie das ein oder andere Video so viral gehen konnte. Sie dachten sich, das kann ich auch. Nur waren Sie dann doch zu bequem es umzusetzen, da es zu viel Zeit und Mühe in Anspruch nehmen würde. Um das zu überwinden möchten wir Trending Trawler vorstellen. 

Mit unserer innovativen Web-App, ermöglichen wir Nutzern die einzigartige Möglichkeit, mit nur einem Klick virale Videos für Social Media zu generieren. Die Plattform kombiniert Hintergrundvideos von beliebten Spielen wie Minecraft und GTA Speedruns mit den heißesten Kommentaren eines Reddit-Threads. Diese Kombination schafft ein einzigartiges Video, das garantiert eine Dopaminbombe ausschütten wird.

Und das Beste? Der Nutzer muss keine Design- oder Videobearbeitungskenntnisse haben, um Trending-Trawler zu nutzen. Unsere benutzerfreundliche Oberfläche macht es kinderleicht, die Videos zu erstellen und aus einer Vielzahl von Optionen anzupassen. Sie können die Sprache und den Dialekt für die Text-to-Speech-Stimme, das Hintergrundvideo und den Reddit-Thread nach Belieben ändern oder durch unsere State-of-the-Art Algorithmen auswählen lassen. Das System durchsucht dann automatisiert die neuesten und heißesten Kommentare aus dem Reddit-Thread und generiert ein Video-Clip, das für Social-Media-Plattformen wie TikTok, Instagram und Twitter optimiert ist. Unsere Anwendung ist dabei nicht nur intelligent sondern auch blazingly fast!

Insgesamt bietet Trending-Trawler also eine einfache und effektive Lösung für Influencer und Social-Media-Enthusiasten, virale Videos ohne Design- oder Videobearbeitungskenntnisse zu erstellen und somit viel Zeit und Mühe zu sparen.