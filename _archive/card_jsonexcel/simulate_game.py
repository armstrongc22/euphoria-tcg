from __future__ import annotations

import argparse
from typing import Optional

from euphoria_rules_engine import (
    GameState,
    PlayerState,
    RulesEngine,
    build_sample_deck,
    describe_card,
    describe_permanent,
    load_cards_from_json,
)


def print_help():
    print("""
Commands:
  help
  status
  hand
  field
  summon <hand_index>
  item <hand_index> [target_player_index] [target_field_index]
  weapon <hand_index> <your_field_index>
  battle
  attack <your_field_index> <opponent_field_index>
  attacks <your_field_index>
  direct <your_field_index>
  end
  quit

Notes:
  - Indexes are zero-based.
  - target_player_index is 0 for Player 1, 1 for Player 2.
  - Items and Weapons are Main Phase only.
  - Attack cards are prompted only when attacking another Warrior.
  - Direct attacks never prompt Attack cards.
  - Use attacks <your_field_index> to preview compatible, affordable, coded Attack cards.
""")


def print_status(game: GameState):
    print("\n================ STATUS ================")
    print(f"Turn: {game.turn_number} | Phase: {game.phase.value} | Current: {game.current_player.name}")
    for i, player in enumerate(game.players):
        print(f"\nPlayer {i}: {player.name}")
        print(f"  Lives: {player.lives}")
        print(f"  Spirit: {player.spirit}")
        print(f"  Deck: {len(player.deck)} | Hand: {len(player.hand)} | Field: {len(player.field)} | Out deck: {len(player.out_deck)}")
    print("========================================")


def print_hand(player: PlayerState):
    print(f"\n{player.name}'s hand:")
    if not player.hand:
        print("  [empty]")
        return
    for i, card in enumerate(player.hand):
        print(f"  {i}: {describe_card(card)}")


def print_field(game: GameState):
    print("\nField:")
    for pi, player in enumerate(game.players):
        print(f"\nPlayer {pi}: {player.name}")
        if not player.field:
            print("  [empty]")
            continue
        for i, permanent in enumerate(player.field):
            print(f"  {i}: {describe_permanent(permanent)}")


def print_compatible_attacks(engine: RulesEngine, game: GameState, attacker_index: int):
    if attacker_index < 0 or attacker_index >= len(game.current_player.field):
        print(f"[ERROR] Invalid field index: {attacker_index}")
        return

    attacker = game.current_player.field[attacker_index]
    compatible = engine.get_compatible_attack_cards(attacker)
    print(f"\nCompatible Attack cards for {attacker.card.name}:")
    if not compatible:
        print("  [none available: must match faction/Neutral, be affordable, and have a coded effect]")
        return

    for hand_index, card in compatible:
        print(f"  {hand_index}: {card.name} | Cost {card.spirit_cost} | {card.rules_text}")

def attack_prompt(attacker, defender, compatible, player) -> Optional[int]:
    print(f"\n{attacker.card.name} is attacking {defender.card.name}.")
    print("Compatible Attack cards:")
    for hand_index, card in compatible:
        print(f"  {hand_index}: {card.name} | Cost {card.spirit_cost} | {card.rules_text}")
    choice = input("Use an Attack card? Enter hand index or press Enter to resolve combat: ").strip()
    if choice == "":
        return None
    try:
        return int(choice)
    except ValueError:
        print("Invalid choice. Resolving combat without another Attack card.")
        return None


def run(json_path: str, p1_faction: str, p2_faction: str, deck_size: int, seed: Optional[int]):
    all_cards = load_cards_from_json(json_path)
    p1_deck = build_sample_deck(all_cards, p1_faction, deck_size=deck_size)
    p2_deck = build_sample_deck(all_cards, p2_faction, deck_size=deck_size)

    p1 = PlayerState(name=f"Player 1 ({p1_faction})", deck=p1_deck)
    p2 = PlayerState(name=f"Player 2 ({p2_faction})", deck=p2_deck)

    game = GameState(players=[p1, p2])
    engine = RulesEngine(game)
    engine.start_game(shuffle=True, seed=seed)
    print_help()

    while not game.winner:
        prompt = f"\n[{game.current_player.name} | {game.phase.value} | Spirit {game.current_player.spirit}] > "
        raw = input(prompt).strip()
        if not raw:
            continue
        parts = raw.split()
        cmd = parts[0].lower()
        args = parts[1:]

        try:
            if cmd in {"quit", "exit"}:
                break
            elif cmd == "help":
                print_help()
            elif cmd == "status":
                print_status(game)
            elif cmd == "hand":
                print_hand(game.current_player)
            elif cmd == "field":
                print_field(game)
            elif cmd == "summon":
                if len(args) != 1:
                    print("Usage: summon <hand_index>")
                    continue
                engine.summon_warrior(int(args[0]))
            elif cmd == "item":
                if len(args) not in {1, 3}:
                    print("Usage: item <hand_index> [target_player_index] [target_field_index]")
                    continue
                hand_index = int(args[0])
                target_player_index = int(args[1]) if len(args) == 3 else None
                target_field_index = int(args[2]) if len(args) == 3 else None
                engine.play_item(hand_index, target_player_index, target_field_index)
            elif cmd == "weapon":
                if len(args) != 2:
                    print("Usage: weapon <hand_index> <your_field_index>")
                    continue
                engine.equip_weapon(int(args[0]), int(args[1]))
            elif cmd == "battle":
                engine.enter_battle_phase()
            elif cmd == "attacks":
                if len(args) != 1:
                    print("Usage: attacks <your_field_index>")
                    continue
                print_compatible_attacks(engine, game, int(args[0]))
            elif cmd == "attack":
                if len(args) != 2:
                    print("Usage: attack <your_field_index> <opponent_field_index>")
                    continue
                engine.attack_warrior(int(args[0]), int(args[1]), prompt_callback=attack_prompt)
            elif cmd == "direct":
                if len(args) != 1:
                    print("Usage: direct <your_field_index>")
                    continue
                engine.direct_attack(int(args[0]))
            elif cmd == "end":
                engine.end_turn()
            else:
                print(f"Unknown command: {cmd}. Type help.")
        except Exception as exc:
            print(f"[ERROR] {exc}")

    if game.winner:
        print(f"\nWinner: {game.winner}")


def main():
    parser = argparse.ArgumentParser(description="Euphoria TCG text simulator.")
    parser.add_argument("--json", required=True, help="Path to cards_file.json")
    parser.add_argument("--p1", default="Monk", help="Player 1 faction")
    parser.add_argument("--p2", default="Dwarf", help="Player 2 faction")
    parser.add_argument("--deck-size", type=int, default=30, help="Deck size")
    parser.add_argument("--seed", type=int, default=None, help="Shuffle seed")
    args = parser.parse_args()
    run(args.json, args.p1, args.p2, args.deck_size, args.seed)


if __name__ == "__main__":
    main()
