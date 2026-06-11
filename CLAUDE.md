# Euphoria TCG Local Project

You are helping build a local-first trading card game engine and website for Euphoria.

## Priorities
- Use TypeScript.
- Keep game logic separate from UI.
- Keep card data separate from game logic.
- Use path-agnostic code.
- Never hardcode Windows paths.
- Add or update tests for every rules-engine change.
- Do not make huge rewrites without explaining the plan first.
- Before destructive actions, ask for approval.

## Project goal
Build:
- a card database
- a rules engine
- a local simulator
- a deck builder
- a public card viewer website

## Current Euphoria TCG rules
- Deck size: 30.
- Starting hand: 5.
- Starting Spirit: 1.
- Gain 1 Spirit at the start of turn before draw.
- Player 1 draws on first turn.
- No attacks allowed on first turn.
- Lives: 3.
- Direct attacks only if opponent has no Warriors.
- Limit 1 direct attack per turn.
- Warriors can attack the turn they are summoned.
- Attacker does not take counter damage.
- After battle stage begins, Items and Weapons cannot be played.
- One Weapon per Warrior.
- Weapons die with attached Warrior.
- Weapons cannot be replaced or moved.
- Used Items/Attacks and destroyed Warriors/Weapons go to the Out Deck.

## Costs
- Attacks cost 1 Spirit.
- Weapons cost 2 Spirit.
- Items cost 1 Spirit.
- Shamans cost 3 Spirit.

## Factions
- Monk
- Dwarf
- Sonic
- Surfer
- Shaman
