/**
 * Blog post content for the Euphoria Universe site. The canonical drafts are
 * the .docx files in /content/blog-source-documents (see its README for the
 * mapping); the copy here is those documents lightly copyedited for the web —
 * typo fixes, paragraph breaks, and section headings only.
 *
 * Two post kinds:
 * - "article": a normal polished blog page rendered from `blocks`.
 * - "restricted": the Shaman special case — no lore body at all. The page
 *   renders as a corrupted/restricted archive file; the missing information
 *   IS the worldbuilding, so never attach blocks to it.
 */

export type BlogTone = "red" | "blue" | "white" | "green" | "purple" | "gold";

export type BlogBlock =
  | { readonly kind: "p"; readonly text: string }
  | { readonly kind: "h2"; readonly text: string }
  | { readonly kind: "pull"; readonly text: string };

export interface BlogPost {
  readonly slug: string;
  readonly number: number;
  readonly title: string;
  readonly eyebrow: string;
  readonly tone: BlogTone;
  readonly summary: string;
  readonly sourceDoc: string;
  readonly kind: "article" | "restricted";
  readonly blocks?: readonly BlogBlock[];
}

const p = (text: string): BlogBlock => ({ kind: "p", text });
const h2 = (text: string): BlogBlock => ({ kind: "h2", text });
const pull = (text: string): BlogBlock => ({ kind: "pull", text });

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: "what-is-euphoria",
    number: 1,
    title: "What is Euphoria?",
    eyebrow: "Founder's Letter",
    tone: "gold",
    summary:
      "A map drawn on a yellow legal pad in high school became three sagas and thirty arcs. This is where Euphoria came from — and why it needs you.",
    sourceDoc: "blog-1-what-is-euphoria.docx",
    kind: "article",
    blocks: [
      p(
        "When I was in high school, I drew the first map of Euphoria in one of those yellow legal pads. Throughout the school year, I labeled it with imaginary cities and historical sites from a fantasy world that only existed in my mind. I even began writing bios for characters that would go on to become Nexus, Titus, Cascade, and a few others.",
      ),
      p("Then, I forgot about it."),
      p(
        "Seven years passed. I traveled, got my heart broken, read, failed, ached, experienced, and learned. Then I went back to school to finish my undergraduate degree. During that time, I distilled my experiences into what has now become the Euphoria manga universe.",
      ),
      p(
        "Three sagas, broken down into thirty fully outlined arcs of action, crime, political intrigue, war, love, and more — with the continent of Euphoria, and all its mysteries, at the center. Hundreds of thousands of years into the future, Earth has produced four supernatural species that now control the last habitable stretch of land on the planet. And a group of god-like regulators to keep everything balanced.",
      ),
      h2("The Tall Task"),
      p(
        "The only thing standing between me and my life's work reaching the masses, to my mind, was the art. I can't draw. So the onus was on me to find an artist capable of taking the images and scenes in my head and delivering them to the world. That proved to be a tall task. I realized that hiring one single artist to carry this burden was similar to hiring a founding partner — and if I didn't find the needle in a haystack, my work would go unrealized.",
      ),
      p(
        "Finding a solution took some time. I hired around five artists and never got a single chapter finished, for one reason or another. That's when I learned of manga studios: dispassionate, but willing and able to distribute creative resources toward my goals — if I had enough money. And enough money was a designation far exceeding my capabilities.",
      ),
      h2("So I Come to You"),
      p(
        "Lover of epics that transport you. Dreamer of worlds beyond our imagination. Those seeking that indescribable feeling. Those yearning for a group committed to delivering, week after week, until what lives before you is something that stretches past the horizon.",
      ),
      pull("Your support could be the building blocks for Euphoria."),
    ],
  },
  {
    slug: "the-world-of-euphoria",
    number: 2,
    title: "The World of Euphoria",
    eyebrow: "World Primer",
    tone: "blue",
    summary:
      "Four supernatural species, one last habitable continent, and a bedrock of crime beneath it all. An introduction to the world and its wars.",
    sourceDoc: "blog-2-the-world-of-euphoria.docx",
    kind: "article",
    blocks: [
      p(
        "Over the course of the next five hundred thousand years, the Earth experienced multiple events that drastically shifted the planet's geography and population. Chief among them was the creation of four supernatural species that currently vie for control of the last habitable continent on the planet.",
      ),
      p(
        "Each faction — Surfer, Dwarf, Sonic, and Monk — is locked in a power struggle that has lasted since their emergence. War has ravaged the continent of Euphoria, with the continent itself shifting with the strength of each faction. Little Lake National Park, and the resulting tourist attraction, is actually the result of an anomaly created during the Battle of Little Lake. The Atlas Land Bridge was created by Rajah Atlas Alacapati, who couldn't allow the Monks the four days it would have taken to move his troops by boat.",
      ),
      p(
        "The history of Euphoria is marked by these monumental events that influence the following chapter of the continent. The wars create orphans and displaced communities. As the borders shift, people lose rights and security. And when they inevitably lose it all, there is hardly any recourse.",
      ),
      h2("The Bedrock of Crime"),
      p(
        "In a world in a constant state of conflict, there exists the space for extralegal authority — and in Euphoria, most of that space is occupied by criminals. There are powerful warriors and factions across the continent, but criminal organizations are largely recognized as the second strongest sect of power. These organizations control entire cities, and in the case of the Aldebaran territories, even an entire nation.",
      ),
      h2("No Shortage of Stories"),
      p(
        "Across the continent, there are witnesses to events that defy the imagination. Battles that shape the destiny of nations. Crimes that shock the heart of society. Quests to uncover treasures long forgotten to time. And ancient magic, fighting against the sacred seals used to keep it in check. All of these stories, with a single thread tying them together.",
      ),
      pull(
        "Euphoria is the search for the center of all things. And everything along the path to it.",
      ),
    ],
  },
  {
    slug: "dwarves",
    number: 3,
    title: "The Dwarves",
    eyebrow: "Faction File · Dwarf",
    tone: "green",
    summary:
      "Earth-manipulating standard-bearers of Euphoria's new age. An aging Rajah, unproven heirs, ambitious lords — and a long way to fall.",
    sourceDoc: "blog-3-dwarves.docx",
    kind: "article",
    blocks: [
      p(
        "For the last three hundred thousand years, mainland Euphoria has been dominated by two great powers: the Monks and the Dwarves.",
      ),
      p(
        "These two factions have warred almost nonstop, leaving the continent ravaged in their wake. The Monks, fire-manipulating pillars of tradition and discipline, have slowly chipped away at the sovereignty of the other nations. The Dwarves, earth-manipulating wielders of unparalleled strength and athleticism, have enforced their will against anyone they believe threatens the peace they fought to establish.",
      ),
      p(
        "Dwarven history is rich with heroes, warriors, and leaders who stood against imperialism, greed, and foreign domination. Their ruler, the Rajah, is chosen by bloodline and expected to uphold the standards set by those who came before. Over time, the Rajah has become a symbol of peace and stability on a continent defined by war, shifting borders, and constant upheaval.",
      ),
      h2("The Alacapati Rajahs"),
      p(
        "The last two Rajahs, Atlas Alacapati and Giga Alacapati, cemented the Dwarf nation as one of the standard-bearers of Euphoria's new age.",
      ),
      p(
        "Atlas Alacapati was the first of the Alacapati clan to become Rajah. He battled the great Molt the Dragon Tamer throughout a campaign that decided the fate of the continent for the next hundred thousand years. His victory earned him reverence not only among the Dwarves, but across all of Euphoria.",
      ),
      p(
        "His son, Giga Alacapati, known as Giga the Diamond, may have been the only Dwarf capable of following his father's exploits. Before Giga's reign, there was relative parity among the nations in terms of wealth and economic power. But Giga's uniquely refined earth-manipulation technique allowed him to create diamonds at will.",
      ),
      p(
        "From this gift came a wellspring of prosperity for the Dwarves. Trade routes expanded across the nation. Cities exploded in size. Wealth that would normally have consolidated at the top began to flow down through several layers of Dwarven society. Now, the Dwarves sit at the head of the table in Euphorian society. But that has not dissuaded the Monks from trying to end their reign and reclaim that position for themselves.",
      ),
      h2("The Four Lords"),
      p(
        "Increased Monk aggression comes at a dangerous time for the Dwarves. Giga the Diamond is getting older, and there is no clear heir to his throne. His children, Aaron and Cecilia, have yet to complete the Trial of Gia, the ancient rite that determines who will become the next Rajah. This has become a source of great consternation among the Dwarven elite, especially the four Dwarven Lords.",
      ),
      p(
        "Unlike the other nations, the Dwarf nation's power does not reside solely with its leader. In Dwarven society, forty-nine percent of executive authority belongs to the Rajah. The remainder is split between the four other clans capable of ascending to the throne. These clan lords control entire regions and wield extraordinary influence. While there is a standing decorum around cooperation, the lords remain independent. The preservation of the Dwarf nation is their highest priority — but ultimately, each lord desires the throne for their own clan.",
      ),
      p(
        "What preserves order within Dwarven society is a dogmatic adherence to an ancient faith built around a magic at the root of Euphoria itself. Dwarves credit this faith with their strength and resilience. To aggressively challenge the structure would mean banishment from Dwarven society — and with it, the loss of that strength.",
      ),
      h2("Cracks in the Armor"),
      p(
        "Though they are positioned as leaders of the continent, there are numerous cracks in the Dwarven armor. Their king is aging. Their heirs are unproven. Their lords are ambitious. Their enemies are advancing.",
      ),
      p("The future of the Dwarves, like all of Euphoria, is uncertain."),
      pull("And from their perch, it would be a long fall."),
    ],
  },
  {
    slug: "monks",
    number: 4,
    title: "The Monks",
    eyebrow: "Faction File · Monk",
    tone: "red",
    summary:
      "The youngest nation, forged from four warring tribes into a holy empire. What began as self-defense became doctrine — and the doctrine became an empire.",
    sourceDoc: "blog-4-monks.docx",
    kind: "article",
    blocks: [
      p(
        "Though many acknowledge the Dwarves as the leading nation in Euphoria, the Monks refuse to accept that belief.",
      ),
      p(
        "Ever since Molt the Dragon Tamer scorched Euphoria and threatened to engulf the entire continent beneath his flag, the Monks have been determined to leave no doubt about which nation deserves the honor of being called the strongest.",
      ),
      h2("The Youngest Nation"),
      p(
        "The Monk nation is actually the youngest of the four. Western Euphoria was initially home to four nomadic tribes: the Wa, Sun, Kugal, and Hu. Each had its own strengths, customs, and ideology. But the tribes were constantly in conflict, preventing population growth, innovation, and any meaningful political unity.",
      ),
      p("For most of Euphoria's history, the Monks were an afterthought."),
      p("Then came Prometheus Wa."),
      p(
        "Prometheus Wa was the greatest blacksmith in a tribe already known for producing excellent artisans and armorers. Euphorians regularly braved the trek into lawless Monk territory to purchase his wares. With that renown came respect among the four tribes. But his wisdom, oratory, skill as a warrior, and gift for diplomacy were equally important pillars of his legend.",
      ),
      p("It was through these gifts that Prometheus Wa unified the four tribes."),
      p(
        "When his work was done, the Holy Monk Empire was born. Since then, a Wa has always sat on the throne, leading, building, and nurturing the idea Prometheus placed into the hearts of all Monks: that they were not scattered tribes waiting to be conquered. They were a people. A nation. A fire.",
      ),
      h2("The Kindling"),
      p("The rest of Euphoria did not take kindly to this newfound self-determination."),
      p(
        "The Monks faced an onslaught from all sides. That war, known as The Kindling, continues to influence Monk foreign and domestic policy to this day. From it emerged a hyper-nationalist belief that the only way to guarantee Monk survival was to control Euphoria completely.",
      ),
      pull("What began as self-defense became doctrine. And that doctrine became an empire."),
      h2("The Holy Emperor"),
      p(
        "The current face of that empire is the beloved Holy Emperor Hi No Wa. As emperors go, Hi No Wa's reign has been extremely consequential. He has brought subtlety to Monk imperialism, allowing the nation's tendrils to slowly ensnare the continent without provoking full retaliation from the other powers. Through coercion, blackmail, assassination, propaganda, and other tactics, Hi No Wa may represent the closest a Monk emperor has ever come to realizing the empire that grew from Prometheus Wa's vision.",
      ),
      p(
        "His daughter, Pyra Wa, is an equally notorious force in Euphoria. Though women are prohibited from taking the Monk throne, Pyra has shown no sign that tradition will stop her. Her vast intelligence network powers the nation's military, political, and economic engines, allowing her father to execute his agenda with terrifying precision. With Holy Emperor Hi No Wa aging, many believe Pyra is the only one capable of wrangling the countless threads and keeping the Monk nation on its current trajectory — despite her sadistic, unhinged reputation.",
      ),
      p(
        "But there is a small faction that believes her son, Pyrus, may be the key to a new way of life for the Monks. The boy is empathetic, studious, humble, discerning, and judicious. Everything his mother lacks, with all the nationalist fervor that endears a politician to the Monk people. But with Pyra's ambition, influence, and near-omnipresent reach, prying her son from her arms may be a task beyond anyone in the Monk political infrastructure.",
      ),
      h2("A Leaning Tower"),
      p(
        "The Monks have built an empire on continuity, cooperation, and an unshakable belief in a common goal. But what was once seen as an iron tower — impenetrable and resolute — has begun to lean, ever so slightly.",
      ),
      pull("The direction of that lean has yet to be decided."),
    ],
  },
  {
    slug: "surfers",
    number: 5,
    title: "The Surfers",
    eyebrow: "Faction File · Surfer",
    tone: "white",
    summary:
      "Five billion citizens beneath the sea, a deposed queen, an occupying 'ally', and a rebellion boiling over. The Surfer nation is teetering on the brink.",
    sourceDoc: "blog-5-surfers.docx",
    kind: "article",
    blocks: [
      p(
        "As the most populous nation in Euphoria, with roughly five billion citizens spread across the ocean floor, a naive observer might assume the Surfers would easily control the continent.",
      ),
      p("They would be wrong."),
      p(
        "The plight of the Surfers may be the most outwardly perilous of any nation in Euphoria. Once known as an economic powerhouse, the Surfer nation has been decimated by consecutive military and political defeats, foreign manipulation, and royal infighting. Starvation is rampant. Trust in the throne is collapsing. And a malicious rebel threat is boiling over in the country's underbelly.",
      ),
      p("It wasn't always this way."),
      h2("The Fall of Queen Shiva"),
      p(
        "Even a few thousand years ago, the Surfer nation looked to be on the mend. Queen Shiva had taken the throne and implemented a national identity that defied the meek, ineffective one that preceded her. She was a prodigious strategist, and her agenda was beginning to breathe new life into a once-proud people.",
      ),
      p("Then Holy Emperor Hi No Wa turned his attention to the nation beneath the sea."),
      p(
        "The Monks allocated all of their political resources, both official and clandestine, toward dismantling Queen Shiva's reign. They committed atrocities and made sure Shiva received the blame. Then they unleashed a continent-wide propaganda campaign to damage her reputation beyond repair, even among her own citizens. Finally, with full authority granted by the Euphorian Senate, they marched on Marina, the capital city, and deposed Queen Shiva.",
      ),
      h2("Assistance Becomes Control"),
      p(
        "Since then, the Renvatten family has taken the throne. But the tempest left in Shiva's wake has pushed the Surfer nation to the verge of collapse. After exiling Shiva, the Monks remained to offer assistance in the rebuilding effort. Slowly, they increased the Surfers' reliance on Monk resources while imposing harsher and harsher conditions for receiving aid.",
      ),
      p("Eventually, assistance became control."),
      p(
        "The Monks became a de facto occupying authority, oppressing the very people they claimed to protect.",
      ),
      p(
        "This situation, largely ignored by Euphoria at large, is becoming increasingly untenable. A rebel faction has begun to form, and its hatred for the Monk-backed Renvattens is becoming less fringe by the day. As more citizens adopt the rebels' beliefs, the Monks apply pressure to the Renvatten throne, forcing the royal family to crack down on the rebels — and, by extension, the citizens themselves. Every crackdown only feeds the next wave of rebel sentiment.",
      ),
      h2("Sailors and Pirates"),
      p(
        "These skirmishes have destroyed trust in Surfer trade, crippling the economy even further. Euphorians can no longer trust that their goods will safely pass through Surfer waters without falling into rebel hands.",
      ),
      p(
        "But from this chaos has emerged a new generation of sailors eager to make a name for themselves. And with stronger sailors come stronger pirates.",
      ),
      p(
        "The seas of Euphoria have become a whirlpool of talented warriors, smugglers, raiders, rebels, and captains all looking to etch their names into history.",
      ),
      h2("The Euphrates Tribe"),
      p(
        "All the while, tucked away in their icy tundra and almost completely divorced from the troubles of broader Surfer society, are the Euphrates tribe. The Euphrates are an indigenous tribe of Surfers born with ice-manipulating abilities uncommon among most Surfer phenotypes. Many believe the Euphrates were banished to their frozen territory. While there is no clear evidence proving that claim, there is good reason the belief persists.",
      ),
      p(
        "Euphrates tribe members are viciously persecuted by Surfer society. Prejudice runs deep, and that hatred has resulted in discrimination so violent that Euphrates tribe members are rarely seen in cities like Marina and Alta. The Sonic nation often makes incursions into Euphrates territory, and the world-renowned Surfer Navy has almost never come to their defense.",
      ),
      h2("On the Brink"),
      p(
        "The Surfers have more than their fair share of problems. Many doubt the Renvattens are capable of navigating such tumultuous waters. Queen Cascade must wrangle political threats both foreign and domestic, contain a growing rebellion, manage Monk influence, rebuild a shattered economy, and fight off the impending tsunami threatening to wash away her regime.",
      ),
      p("The Surfer nation is already teetering on the brink."),
      pull("One has to wonder whether any of the other nations will finally push them over the edge."),
    ],
  },
  {
    slug: "shamans",
    number: 6,
    title: "The Shamans",
    eyebrow: "Faction File · Shaman",
    tone: "purple",
    summary:
      "ACCESS DENIED · ARCHIVE STATUS: COMPROMISED · CLASSIFICATION: EXTREME RISK",
    sourceDoc: "blog-6-shamans.docx",
    kind: "restricted",
  },
  {
    slug: "port-troy",
    number: 7,
    title: "Port Troy",
    eyebrow: "Location File · Human Territory",
    tone: "gold",
    summary:
      "A trade-port metropolis that sells beauty above ground and buries sin beneath it — with Silence Row screaming just beyond the lights.",
    sourceDoc: "blog-7-port-troy.docx",
    kind: "article",
    blocks: [
      p(
        "Though they are an extreme minority, and almost completely excluded from the highest levels of political influence on the continent, Humans have still managed to occupy significant positions in Euphoria's ecosystem.",
      ),
      p("One of those positions is the trade-port metropolis of Port Troy."),
      h2("The House of Commerce"),
      p(
        "Forty percent of the continent's mainland-bound goods pass through the massive port every year, feeding one of Euphoria's largest marketplaces. Unlike many of Euphoria's other trade hubs, Port Troy's metropolitan flair attracts the wealthiest patrons on the continent. Every year, they pour in to indulge in five-star dining, world-renowned entertainment, impeccable shopping, and celebrity people-watching.",
      ),
      p(
        "But it is not only tourists looking to drain all they can from Port Troy. Many arrive with dreams of making their fortune in this house of commerce.",
      ),
      p(
        "Speculative trading, aggressive capital investments, and elaborate cons burn ten times as many people as those who find gold in the streets of Port Troy. For every successful nightclub, there are dozens of bodies dumped into the sea over missed loan payments. And just beyond the seaside jewel on Euphoria's southern coast lies a forest of pain and neglect.",
      ),
      h2("Silence Row"),
      p(
        "Silence Row is a shanty city bordering Port Troy proper, but for all intents and purposes, it is an extension of its glitzy neighbor. Marks, failures, victims of extortion and theft, and anyone who could not achieve their dreams in Port Troy eventually learn to scrape by in Silence Row.",
      ),
      p("This is not an easy existence."),
      p(
        "Some of Euphoria's most notorious criminals hail from Silence Row, and there is no shortage of those who aspire to reach similar heights. Ward dons, thief groups, gladiators, and murderers impose a violent meritocracy that would offend the sensibilities of those residing in Port Troy's bosom — if they ever cared enough to turn their attention toward Silence Row's suffering.",
      ),
      p(
        "Silence Row earned its name from the apathetic attitude the region paid to those being crushed under the city's oppressive burden. Port Troy even went so far as to annex the area and allow it its own municipality, avoiding any real obligation to govern or protect it. The feeble local government quickly succumbed to the criminal element, and from that moment on, Silence Row's screams were ignored by the outside world.",
      ),
      h2("The Fort and the Vaults"),
      p("Port Troy would much rather remind the world of its expansive renovations to the city fort."),
      p(
        "The twenty-year remodel created an architectural marvel worthy of the many postcards sent from the city every year. The fort now encompasses thirty percent of Port Troy proper, towering over the city like a gate. Freshly minted ion cannons, fryzene alloy battlements, and a steady stream of elite soldiers protect Port Troy from whatever storms may blow in from the sea.",
      ),
      p("But that is not all Port Troy's fort offers."),
      p(
        "Deep beneath the surface is a catacomb of vaults used by the Euphorian elite to hide their deepest secrets. These vaults are issued and filled anonymously by the corrupt city council at exorbitant fees. No one knows for sure how foul the contents are, but those who work in Port Troy's vaults have regularly testified to the perceived character of the vault holders.",
      ),
      h2("A City of Opposed Identities"),
      p(
        "The have-nots have quietly supported those who have, straining under the weight of a city that sells beauty above ground and buries sin beneath it.",
      ),
      p("How long can that truly last?"),
      pull("And what force is strong enough to shift a dynamic built into the very foundation of the city?"),
    ],
  },
];

/** Look up a post by its URL slug; undefined for unknown slugs (→ 404 UI). */
export function findPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

/** Docket neighbors of a post: the previous and next entries by number. */
export function adjacentPosts(slug: string): {
  prev: BlogPost | undefined;
  next: BlogPost | undefined;
} {
  const i = BLOG_POSTS.findIndex((post) => post.slug === slug);
  if (i === -1) return { prev: undefined, next: undefined };
  return { prev: BLOG_POSTS[i - 1], next: BLOG_POSTS[i + 1] };
}
