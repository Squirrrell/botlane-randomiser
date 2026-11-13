# Botlane Randomiser

A small static site that rolls a random League of Legends bot lane duo. It's meant for off-meta picks: Kayn support, Yuumi ADC, that kind of thing.

## How it works

There are two slots, Bot lane and Support. Above each card you pick which roles that champion can come from (Top, Jungle, Mid, Bot, Support). One Roll button rolls both slots.

- **Off-meta only** (on by default) skips any champion who normally plays the lane they're rolled into, so the support slot never gives you Thresh. Each slot's own lane icon (Bot for the bot slot, Support for the support slot) starts switched off. Turn it on and real bot laners or supports come back into that slot's pool.
- **Lock** keeps a champion while you reroll the other slot.
- Press **R** to roll from the keyboard.
- Your role choices and the last six duos stay in your browser between visits.
- The whole page fits on one screen. The cards grow or shrink with the window height.

Champion names and art come from Riot's Data Dragon, loaded live, so new champions appear without any change here. The usual lanes for each champion live in [`js/roles.js`](js/roles.js). A champion missing from that list gets lanes guessed from its Riot class tags until someone adds it.

## Running it locally

It's plain HTML, CSS and JavaScript with no build step. Serve the folder with any static server:

```bash
python -m http.server 5517
```

Then open http://localhost:5517.

## Publishing on GitHub Pages

Push to a GitHub repository, then go to Settings > Pages and deploy from the `main` branch, root folder.

## Legal

Botlane Randomiser isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

Role icons come from [CommunityDragon](https://www.communitydragon.org/).
