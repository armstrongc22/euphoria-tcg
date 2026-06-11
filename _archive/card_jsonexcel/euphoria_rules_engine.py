from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple
import copy
import json
import random
import re
import unicodedata


class CardType(str, Enum):
    WARRIOR = "Warrior"
    ITEM = "Item"
    WEAPON = "Weapon"
    ATTACK = "Attack"


class Phase(str, Enum):
    START = "Start"
    MAIN = "Main"
    BATTLE = "Battle"
    END = "End"


DEFAULT_RULES = {
    "deck_size": 30,
    "starting_hand_size": 5,
    "starting_spirit": 1,
    "spirit_gain_per_turn": 1,
    "max_spirit": None,
    "lives": 3,
    "warrior_slots": 5,
    "no_attacks_on_first_turn": True,
    "one_direct_attack_per_turn": True,
    "warriors_can_attack_turn_summoned": True,
    "combat_damage_simultaneous": False,
    "attack_cards_on_direct_attacks": False,
    "one_weapon_per_warrior": True,
}


def normalize_key(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = text.replace("&", "and")
    text = text.replace("’", "")
    text = text.replace("'", "")
    text = text.replace("“", "")
    text = text.replace("”", "")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text


def safe_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def first_present(data: dict, keys: List[str], default: Any = None) -> Any:
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return default


def normalize_type(value: Any) -> str:
    raw = "" if value is None else str(value).strip().lower()
    aliases = {
        "warriors": "warrior",
        "unit": "warrior",
        "character": "warrior",
        "items": "item",
        "weapons": "weapon",
        "attacks": "attack",
        "spells": "attack",
    }
    raw = aliases.get(raw, raw)
    if raw == "warrior":
        return CardType.WARRIOR.value
    if raw == "item":
        return CardType.ITEM.value
    if raw == "weapon":
        return CardType.WEAPON.value
    if raw == "attack":
        return CardType.ATTACK.value
    return str(value).strip() if value is not None else ""


def infer_effect_code(effect_key: str) -> str:
    key = normalize_key(effect_key).replace("-", "_").upper()
    mapping = {
        "AOE_DAMAGE_THEN_DELAYED_DAMAGE": "DAMAGE_ALL_OPPONENT_WARRIORS",
        "DAMAGE_ALL_ENEMY_WARRIORS": "DAMAGE_ALL_OPPONENT_WARRIORS",
        "OPPONENT_TEAM_DAMAGE": "DAMAGE_ALL_OPPONENT_WARRIORS",
        "DESTROY_ENEMY_WARRIOR": "DESTROY_TARGET_WARRIOR",
        "ADD_DAMAGE_THIS_TURN": "BUFF_ATTACKING_WARRIOR_THIS_ATTACK",
        "ADD_DAMAGE_TO_NEXT_ATTACK": "BUFF_ATTACKING_WARRIOR_THIS_ATTACK",
        "ADD_DAMAGE_TO_TARGET_WARRIOR_THIS_TURN": "BUFF_ATTACKING_WARRIOR_THIS_ATTACK",
        "ADD_DAMAGE_AND_DISABLE_ATTACKED_WARRIOR": "BUFF_ATTACKING_WARRIOR_THIS_ATTACK",
        "SINGLE_WARRIOR_HEALTH_GAIN": "HEAL_TARGET",
        "TEAM_HEALTH_GAIN": "HEAL_ALL_YOUR_WARRIORS",
        "DELAYED_SPIRIT_ESCROW_GAIN": "SPIRIT_ESCROW",
        "REVIVE_DESTROYED_WARRIOR_TO_YOUR_FIELD": "REVIVE_WARRIOR",
        "ADD_DWARF_WARRIOR_TO_HAND": "SEARCH_DECK",
        "ADD_MONK_ATTACK_OR_WARRIOR_TO_HAND": "SEARCH_DECK",
        "TUTOR_WEAPON_FROM_DECK": "SEARCH_DECK",
        "ADD_WEAPON_CARD_TO_HAND": "SEARCH_DECK",
        "ADD_WEAPON_OR_ITEM_TO_HAND": "SEARCH_DECK",
        "PREVENT_ALL_ATTACKS_UNTIL_NEXT_TURN": "NO_ATTACKS_NEXT_TURN",
    }
    return mapping.get(key, "")


def infer_effect_params(effect: Dict[str, Any]) -> Dict[str, Any]:
    params: Dict[str, Any] = {}
    for key in ["amount", "secondaryAmount", "target", "duration"]:
        if key in effect:
            params[key] = effect[key]
    return params


@dataclass
class Card:
    id: str
    name: str
    slug: str
    faction: str
    type: str
    spirit_cost: int = 0
    attack: int = 0
    health: int = 0
    subtype: str = ""
    rules_text: str = ""
    image_file: str = ""
    rarity: str = ""
    effect_key: str = ""
    effect_code: str = ""
    effect_params: Dict[str, Any] = dc_field(default_factory=dict)
    effects: List[Dict[str, Any]] = dc_field(default_factory=list)
    raw: Dict[str, Any] = dc_field(default_factory=dict)

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "Card":
        name = str(first_present(data, ["name", "Name"], "")).strip()
        slug = str(first_present(data, ["slug", "Slug"], normalize_key(name))).strip() or normalize_key(name)
        card_id = str(first_present(data, ["id", "ID"], slug)).strip() or slug

        effects = first_present(data, ["effects", "Effects"], []) or []
        if isinstance(effects, str):
            try:
                effects = json.loads(effects)
            except json.JSONDecodeError:
                effects = []

        effect_params = first_present(data, ["effect_params", "effectParams", "params"], {}) or {}
        if isinstance(effect_params, str):
            try:
                effect_params = json.loads(effect_params)
            except json.JSONDecodeError:
                effect_params = {}

        effect_key = str(first_present(data, ["effect_key", "effectKey"], "") or "").strip()
        if not effect_key and effects and isinstance(effects, list) and isinstance(effects[0], dict):
            effect_key = str(effects[0].get("key", "")).strip()

        effect_code = str(first_present(data, ["effect_code", "effectCode"], "") or "").strip()
        if not effect_code:
            effect_code = infer_effect_code(effect_key)

        if not effect_params and effects and isinstance(effects, list) and isinstance(effects[0], dict):
            effect_params = infer_effect_params(effects[0])

        return Card(
            id=card_id,
            name=name,
            slug=slug,
            faction=str(first_present(data, ["faction", "Faction"], "Neutral")).strip() or "Neutral",
            type=normalize_type(first_present(data, ["type", "Type", "card_type", "cardType"], "")),
            spirit_cost=safe_int(first_present(data, ["spiritCost", "spirit_cost", "spirit", "Spirit", "cost", "Cost"], 0)),
            attack=safe_int(first_present(data, ["attack", "Attack", "ATK", "atk"], 0)),
            health=safe_int(first_present(data, ["health", "Health", "HEALTH", "hp", "HP"], 0)),
            subtype=str(first_present(data, ["subtype", "Subtype", "category", "Category"], "") or "").strip(),
            rules_text=str(first_present(data, ["rulesText", "rules_text", "effect", "Effect", "description", "Description"], "") or "").strip(),
            image_file=str(first_present(data, ["imageFile", "image_file", "image", "filename"], "") or "").strip(),
            rarity=str(first_present(data, ["rarity", "Rarity"], "") or "").strip(),
            effect_key=effect_key,
            effect_code=effect_code,
            effect_params=effect_params,
            effects=effects if isinstance(effects, list) else [],
            raw=data,
        )

    def clone(self) -> "Card":
        return copy.deepcopy(self)


@dataclass
class Permanent:
    card: Card
    owner_index: int
    current_attack: int
    current_health: int
    max_health: int
    exhausted: bool = False
    can_attack: bool = True
    equipment: List[Card] = dc_field(default_factory=list)
    statuses: Dict[str, Any] = dc_field(default_factory=dict)

    @staticmethod
    def from_card(card: Card, owner_index: int) -> "Permanent":
        return Permanent(
            card=card,
            owner_index=owner_index,
            current_attack=card.attack,
            current_health=card.health,
            max_health=card.health,
            exhausted=False,
            can_attack=True,
        )


@dataclass
class PlayerState:
    name: str
    deck: List[Card]
    hand: List[Card] = dc_field(default_factory=list)
    field: List[Permanent] = dc_field(default_factory=list)
    out_deck: List[Card] = dc_field(default_factory=list)
    spirit: int = 1
    lives: int = 3
    direct_attack_used_this_turn: bool = False
    statuses: Dict[str, Any] = dc_field(default_factory=dict)
    delayed_effects: List[Dict[str, Any]] = dc_field(default_factory=list)

    def draw(self, count: int = 1) -> List[Card]:
        drawn: List[Card] = []
        for _ in range(count):
            if not self.deck:
                break
            card = self.deck.pop(0)
            self.hand.append(card)
            drawn.append(card)
        return drawn

    def spend_spirit(self, amount: int):
        if amount < 0:
            raise ValueError("Cannot spend negative Spirit.")
        if self.spirit < amount:
            raise ValueError(f"{self.name} does not have enough Spirit. Need {amount}, has {self.spirit}.")
        self.spirit -= amount

    def gain_spirit(self, amount: int):
        if amount > 0:
            self.spirit += amount

    def lose_spirit(self, amount: int):
        self.spirit = max(0, self.spirit - max(0, amount))


@dataclass
class GameState:
    players: List[PlayerState]
    rules: Dict[str, Any] = dc_field(default_factory=lambda: copy.deepcopy(DEFAULT_RULES))
    current_player_index: int = 0
    turn_number: int = 1
    phase: Phase = Phase.START
    winner: Optional[str] = None
    log: List[str] = dc_field(default_factory=list)

    @property
    def current_player(self) -> PlayerState:
        return self.players[self.current_player_index]

    @property
    def opponent(self) -> PlayerState:
        return self.players[1 - self.current_player_index]

    @property
    def opponent_index(self) -> int:
        return 1 - self.current_player_index

    def player(self, index: int) -> PlayerState:
        return self.players[index]

    def add_log(self, message: str):
        self.log.append(message)
        print(message)


EffectHandler = Callable[["RulesEngine", Card, Dict[str, Any]], None]


class EffectRegistry:
    def __init__(self):
        self.handlers: Dict[str, EffectHandler] = {}

    def register(self, code: str):
        code = code.strip().upper()

        def decorator(func: EffectHandler):
            self.handlers[code] = func
            return func
        return decorator

    def get_handler(self, card: Card) -> Optional[EffectHandler]:
        code = (card.effect_code or "").strip().upper()
        if not code:
            return None
        return self.handlers.get(code)

    def has_handler(self, card: Card) -> bool:
        return self.get_handler(card) is not None

    def resolve(self, engine: "RulesEngine", card: Card, context: Dict[str, Any]) -> bool:
        code = (card.effect_code or "").strip().upper()
        if not code:
            engine.game.add_log(f"[NO CODED EFFECT] {card.name}: {card.rules_text}")
            return False
        handler = self.handlers.get(code)
        if not handler:
            engine.game.add_log(f"[MISSING HANDLER] {card.name} uses {code}. Text: {card.rules_text}")
            return False
        handler(engine, card, context)
        return True


effects = EffectRegistry()


class RulesEngine:
    def __init__(self, game: GameState, effect_registry: EffectRegistry = effects):
        self.game = game
        self.effects = effect_registry

    def start_game(self, shuffle: bool = True, seed: Optional[int] = None):
        rng = random.Random(seed)
        for player in self.game.players:
            player.spirit = self.game.rules["starting_spirit"]
            player.lives = self.game.rules["lives"]
            if shuffle:
                rng.shuffle(player.deck)
            drawn = player.draw(self.game.rules["starting_hand_size"])
            self.game.add_log(f"{player.name} draws starting hand: {len(drawn)} card(s).")
        self.start_turn()

    def start_turn(self):
        player = self.game.current_player
        self.game.phase = Phase.START
        self.game.add_log("")
        self.game.add_log(f"=== TURN {self.game.turn_number}: {player.name} ===")
        player.direct_attack_used_this_turn = False

        for permanent in player.field:
            permanent.exhausted = False
            permanent.can_attack = True

        self._expire_statuses(player)
        self._resolve_delayed_effects(player)

        player.gain_spirit(self.game.rules["spirit_gain_per_turn"])
        self.game.add_log(f"{player.name} gains {self.game.rules['spirit_gain_per_turn']} Spirit. Spirit: {player.spirit}")

        drawn = player.draw(1)
        if drawn:
            self.game.add_log(f"{player.name} draws {drawn[0].name}.")
        else:
            self.game.add_log(f"{player.name} cannot draw; deck is empty.")

        self.game.phase = Phase.MAIN

    def enter_battle_phase(self):
        if self.game.phase != Phase.MAIN:
            raise ValueError("You can only enter Battle Phase from Main Phase.")
        self.game.phase = Phase.BATTLE
        self.game.add_log(f"{self.game.current_player.name} enters Battle Phase. Main Phase is now locked.")

    def end_turn(self):
        self.game.phase = Phase.END
        self._check_destroyed()
        self._check_win_conditions()
        if self.game.winner:
            return

        self.game.current_player_index = 1 - self.game.current_player_index
        self.game.turn_number += 1
        self.start_turn()

    def summon_warrior(self, hand_index: int) -> Permanent:
        self._require_phase(Phase.MAIN)
        player = self.game.current_player
        card = self._get_hand_card(player, hand_index)

        if card.type != CardType.WARRIOR.value:
            raise ValueError(f"{card.name} is not a Warrior.")
        if len(player.field) >= self.game.rules["warrior_slots"]:
            raise ValueError("Your Warrior field is full.")

        player.spend_spirit(card.spirit_cost)
        player.hand.pop(hand_index)

        permanent = Permanent.from_card(card, self.game.current_player_index)
        player.field.append(permanent)
        self.game.add_log(f"{player.name} summons {card.name} for {card.spirit_cost} Spirit.")
        return permanent

    def play_item(self, hand_index: int, target_player_index: Optional[int] = None, target_field_index: Optional[int] = None) -> Optional[Card]:
        self._require_phase(Phase.MAIN)
        player = self.game.current_player
        card = self._get_hand_card(player, hand_index)

        if card.type != CardType.ITEM.value:
            raise ValueError(f"{card.name} is not an Item.")

        context = {
            "player_index": self.game.current_player_index,
            "target_player_index": target_player_index,
            "target_field_index": target_field_index,
            "event": "play_item",
        }

        if not self._can_pay_and_resolve(player, card, context):
            return None

        player.spend_spirit(card.spirit_cost)
        player.hand.pop(hand_index)

        self.game.add_log(f"{player.name} plays Item: {card.name} for {card.spirit_cost} Spirit.")
        self.effects.resolve(self, card, context)

        player.out_deck.append(card)
        self._check_destroyed()
        return card

    def equip_weapon(self, hand_index: int, target_field_index: int) -> Optional[Permanent]:
        self._require_phase(Phase.MAIN)
        player = self.game.current_player
        card = self._get_hand_card(player, hand_index)

        if card.type != CardType.WEAPON.value:
            raise ValueError(f"{card.name} is not a Weapon.")

        target = self._get_field_permanent(player, target_field_index)

        if self.game.rules["one_weapon_per_warrior"] and target.equipment:
            raise ValueError(f"{target.card.name} already has a Weapon. Weapons cannot be replaced or moved.")

        context = {
            "player_index": self.game.current_player_index,
            "target_player_index": self.game.current_player_index,
            "target_field_index": target_field_index,
            "target_permanent": target,
            "event": "equip_weapon",
        }

        if not self._can_pay_and_resolve(player, card, context):
            return None

        player.spend_spirit(card.spirit_cost)
        player.hand.pop(hand_index)
        target.equipment.append(card)

        self.game.add_log(f"{player.name} equips {card.name} to {target.card.name} for {card.spirit_cost} Spirit.")
        self.effects.resolve(self, card, context)
        return target

    def get_compatible_attack_cards(self, attacker: Permanent, defender: Optional[Permanent] = None) -> List[Tuple[int, Card]]:
        player = self.game.current_player
        compatible: List[Tuple[int, Card]] = []

        for i, card in enumerate(player.hand):
            if card.type != CardType.ATTACK.value:
                continue
            if card.spirit_cost > player.spirit:
                continue
            if normalize_key(card.faction) not in {"neutral", normalize_key(attacker.card.faction)}:
                continue
            if not self._has_coded_effect(card):
                continue

            context = {
                "player_index": self.game.current_player_index,
                "attacker": attacker,
                "defender": defender,
                "target_player_index": self.game.opponent_index,
                "target_field_index": self.game.opponent.field.index(defender) if defender in self.game.opponent.field else None,
                "event": "attack_card",
            }

            # When previewing without a defender, only verify cost/faction/code.
            # During an actual attack, verify the selected card can resolve against that defender.
            if defender is not None:
                can_resolve, _reason = self._effect_can_resolve(card, context, player, card.spirit_cost)
                if not can_resolve:
                    continue

            compatible.append((i, card))

        return compatible

    def attack_warrior(
        self,
        attacker_index: int,
        defender_index: int,
        attack_card_hand_indexes: Optional[List[int]] = None,
        prompt_callback: Optional[Callable[[Permanent, Permanent, List[Tuple[int, Card]], PlayerState], Optional[int]]] = None,
    ):
        if self.game.phase == Phase.MAIN:
            self.enter_battle_phase()
        self._require_phase(Phase.BATTLE)

        if self.game.rules["no_attacks_on_first_turn"] and self.game.turn_number == 1:
            raise ValueError("No attacks are allowed on the first turn of the game.")

        player = self.game.current_player
        opponent = self.game.opponent
        attacker = self._get_field_permanent(player, attacker_index)
        defender = self._get_field_permanent(opponent, defender_index)

        if attacker.exhausted or not attacker.can_attack:
            raise ValueError(f"{attacker.card.name} cannot attack right now.")

        self.game.add_log(f"{player.name}'s {attacker.card.name} attacks {opponent.name}'s {defender.card.name}.")

        if attack_card_hand_indexes is None:
            self._interactive_attack_card_prompt(attacker, defender, prompt_callback)
        else:
            self._use_declared_attack_cards(attacker, defender, attack_card_hand_indexes)

        self.game.add_log(f"Combat resolves: {attacker.card.name} attacks {defender.card.name}.")
        defender.current_health -= attacker.current_attack

        self.game.add_log(f"{defender.card.name} takes {attacker.current_attack} damage.")

        attacker.exhausted = True
        self._check_destroyed()
        self._check_win_conditions()

    def direct_attack(self, attacker_index: int):
        if self.game.phase == Phase.MAIN:
            self.enter_battle_phase()
        self._require_phase(Phase.BATTLE)

        if self.game.rules["no_attacks_on_first_turn"] and self.game.turn_number == 1:
            raise ValueError("No attacks are allowed on the first turn of the game.")

        player = self.game.current_player
        opponent = self.game.opponent
        attacker = self._get_field_permanent(player, attacker_index)

        if opponent.field:
            raise ValueError("Direct attack is only allowed when opponent controls no Warriors.")
        if self.game.rules["one_direct_attack_per_turn"] and player.direct_attack_used_this_turn:
            raise ValueError("Only 1 direct attack is allowed per turn.")
        if attacker.exhausted or not attacker.can_attack:
            raise ValueError(f"{attacker.card.name} cannot attack right now.")

        opponent.lives -= 1
        player.direct_attack_used_this_turn = True
        attacker.exhausted = True
        self.game.add_log(f"{attacker.card.name} attacks directly. {opponent.name} loses 1 life. Lives left: {opponent.lives}")
        self._check_win_conditions()

    def _interactive_attack_card_prompt(self, attacker, defender, prompt_callback):
        player = self.game.current_player
        while True:
            compatible = self.get_compatible_attack_cards(attacker, defender)
            if not compatible:
                if any(c.type == CardType.ATTACK.value for c in player.hand):
                    self.game.add_log("No compatible, affordable, coded Attack cards are available for this attack.")
                return
            if prompt_callback is None:
                return

            choice = prompt_callback(attacker, defender, compatible, player)
            if choice is None:
                return

            if choice not in [i for i, _ in compatible]:
                raise ValueError("Selected Attack card is not compatible, affordable, or coded.")

            if not self._use_single_attack_card(choice, attacker, defender):
                return

    def _use_declared_attack_cards(self, attacker, defender, hand_indexes: List[int]):
        for hand_index in hand_indexes:
            compatible_indexes = [i for i, _ in self.get_compatible_attack_cards(attacker, defender)]
            if hand_index not in compatible_indexes:
                raise ValueError(f"Hand index {hand_index} is not a compatible, affordable, coded Attack card.")
            self._use_single_attack_card(hand_index, attacker, defender)

    def _use_single_attack_card(self, hand_index: int, attacker: Permanent, defender: Permanent) -> bool:
        player = self.game.current_player
        card = self._get_hand_card(player, hand_index)

        if card.type != CardType.ATTACK.value:
            raise ValueError(f"{card.name} is not an Attack card.")
        if normalize_key(card.faction) not in {"neutral", normalize_key(attacker.card.faction)}:
            raise ValueError(f"{card.name} is not compatible with {attacker.card.name}.")

        context = {
            "player_index": self.game.current_player_index,
            "attacker": attacker,
            "defender": defender,
            "target_player_index": self.game.opponent_index,
            "target_field_index": self.game.opponent.field.index(defender) if defender in self.game.opponent.field else None,
            "event": "attack_card",
        }

        if not self._can_pay_and_resolve(player, card, context):
            return False

        player.spend_spirit(card.spirit_cost)
        player.hand.pop(hand_index)

        self.game.add_log(f"{player.name} uses Attack card {card.name} with {attacker.card.name} for {card.spirit_cost} Spirit.")
        self.effects.resolve(self, card, context)

        player.out_deck.append(card)
        self._check_destroyed()
        return True

    def damage_permanent(self, owner_index: int, field_index: int, amount: int):
        player = self.game.player(owner_index)
        permanent = self._get_field_permanent(player, field_index)
        permanent.current_health -= amount
        self.game.add_log(f"{permanent.card.name} takes {amount} damage.")
        self._check_destroyed()

    def heal_permanent(self, owner_index: int, field_index: int, amount: int, allow_overheal: bool = True):
        player = self.game.player(owner_index)
        permanent = self._get_field_permanent(player, field_index)

        if allow_overheal:
            permanent.current_health += amount
            permanent.max_health = max(permanent.max_health, permanent.current_health)
        else:
            permanent.current_health = min(permanent.max_health, permanent.current_health + amount)

        self.game.add_log(f"{permanent.card.name} gains {amount} HEALTH.")

    def buff_attack_for_this_attack(self, permanent: Permanent, amount: int):
        permanent.current_attack += amount
        permanent.statuses.setdefault("temporary_attack_buffs", []).append({"amount": amount, "expires": "end_of_turn"})
        self.game.add_log(f"{permanent.card.name} gains +{amount} ATTACK for this turn/attack.")

    def destroy_permanent(self, owner_index: int, field_index: int):
        player = self.game.player(owner_index)
        permanent = self._get_field_permanent(player, field_index)
        player.field.pop(field_index)
        player.out_deck.append(permanent.card)

        for weapon in permanent.equipment:
            player.out_deck.append(weapon)
            self.game.add_log(f"{weapon.name} goes to the Out deck with {permanent.card.name}.")

        self.game.add_log(f"{permanent.card.name} is destroyed and goes to the Out deck.")

    def search_deck_to_hand(self, player_index: int, card_type: Optional[str] = None, faction: Optional[str] = None) -> Optional[Card]:
        player = self.game.player(player_index)

        for i, card in enumerate(player.deck):
            if card_type and card.type != card_type:
                continue
            if faction and normalize_key(card.faction) != normalize_key(faction):
                continue
            found = player.deck.pop(i)
            player.hand.append(found)
            self.game.add_log(f"{player.name} adds {found.name} from deck to hand.")
            return found

        self.game.add_log(f"{player.name} found no matching card in deck.")
        return None

    def _has_coded_effect(self, card: Card) -> bool:
        return self.effects.has_handler(card)

    def _can_pay_and_resolve(self, player: PlayerState, card: Card, context: Dict[str, Any]) -> bool:
        if not self._has_coded_effect(card):
            code = (card.effect_code or "").strip().upper()
            if code:
                self.game.add_log(f"{card.name} uses {code}, but that effect is not coded yet. No Spirit spent.")
            else:
                self.game.add_log(f"{card.name} does not have a coded effect yet. No Spirit spent.")
            return False

        if player.spirit < card.spirit_cost:
            raise ValueError(f"{player.name} does not have enough Spirit. Need {card.spirit_cost}, has {player.spirit}.")

        can_resolve, reason = self._effect_can_resolve(card, context, player, card.spirit_cost)
        if not can_resolve:
            self.game.add_log(f"{card.name} cannot resolve: {reason}. No Spirit spent.")
            return False

        return True

    def _effect_can_resolve(self, card: Card, context: Dict[str, Any], player: PlayerState, pending_card_cost: int = 0) -> Tuple[bool, str]:
        code = (card.effect_code or "").strip().upper()

        if code == "DAMAGE_ALL_OPPONENT_WARRIORS":
            return (len(self.game.opponent.field) > 0, "opponent has no Warriors")

        if code in {"DAMAGE_TARGET", "DESTROY_TARGET_WARRIOR"}:
            target_player_index = context.get("target_player_index")
            target_field_index = context.get("target_field_index")
            if target_player_index is None or target_field_index is None:
                return False, "a target Warrior is required"
            return self._field_index_exists(target_player_index, target_field_index), "target Warrior does not exist"

        if code == "BUFF_ATTACKING_WARRIOR_THIS_ATTACK":
            return (context.get("attacker") is not None, "an attacking Warrior is required")

        if code == "HEAL_TARGET":
            target_player_index = context.get("target_player_index", context.get("player_index"))
            target_field_index = context.get("target_field_index")
            if target_player_index is None or target_field_index is None:
                return False, "a target Warrior is required"
            return self._field_index_exists(target_player_index, target_field_index), "target Warrior does not exist"

        if code == "HEAL_ALL_YOUR_WARRIORS":
            player_index = context.get("player_index", self.game.current_player_index)
            return (len(self.game.player(player_index).field) > 0, "you control no Warriors")

        if code == "GAIN_SPIRIT":
            return True, ""

        if code == "LOSE_OPPONENT_SPIRIT":
            return (self.game.opponent.spirit > 0, "opponent has no Spirit to lose")

        if code == "SPIRIT_ESCROW":
            amount_in = safe_int(card.effect_params.get("amount", card.effect_params.get("amount_in", 1)))
            available_after_cost = player.spirit - pending_card_cost
            return (available_after_cost >= amount_in, f"needs {amount_in} extra Spirit for escrow after paying card cost")

        if code == "SEARCH_DECK":
            card_type, faction = self._infer_search_constraints(card)
            for deck_card in player.deck:
                if card_type and deck_card.type != card_type:
                    continue
                if faction and normalize_key(deck_card.faction) != normalize_key(faction):
                    continue
                return True, ""
            return False, "no matching card found in deck"

        if code == "REVIVE_WARRIOR":
            if len(player.field) >= self.game.rules["warrior_slots"]:
                return False, "your Warrior field is full"
            return any(c.type == CardType.WARRIOR.value for c in player.out_deck), "no Warrior in your Out deck"

        if code == "NO_ATTACKS_NEXT_TURN":
            return True, ""

        return True, ""

    def _field_index_exists(self, player_index: int, field_index: int) -> bool:
        if player_index < 0 or player_index >= len(self.game.players):
            return False
        return 0 <= field_index < len(self.game.player(player_index).field)

    def _infer_search_constraints(self, card: Card) -> Tuple[Optional[str], Optional[str]]:
        key = normalize_key(card.effect_key or card.rules_text)
        card_type = None
        faction = None

        # If the text says "Weapon or Item", prefer Weapon first for the beta text simulator.
        if "weapon" in key:
            card_type = CardType.WEAPON.value
        elif "item" in key:
            card_type = CardType.ITEM.value
        elif "warrior" in key:
            card_type = CardType.WARRIOR.value
        elif "attack" in key:
            card_type = CardType.ATTACK.value

        for f in ["Dwarf", "Monk", "Sonic", "Surfer", "Shaman"]:
            if normalize_key(f) in key:
                faction = f
                break

        return card_type, faction

    def _require_phase(self, phase: Phase):
        if self.game.phase != phase:
            raise ValueError(f"Required phase: {phase.value}. Current phase: {self.game.phase.value}.")

    def _get_hand_card(self, player: PlayerState, hand_index: int) -> Card:
        if hand_index < 0 or hand_index >= len(player.hand):
            raise IndexError(f"Invalid hand index: {hand_index}")
        return player.hand[hand_index]

    def _get_field_permanent(self, player: PlayerState, field_index: int) -> Permanent:
        if field_index < 0 or field_index >= len(player.field):
            raise IndexError(f"Invalid field index: {field_index}")
        return player.field[field_index]

    def _check_destroyed(self):
        for owner_index, player in enumerate(self.game.players):
            for i in range(len(player.field) - 1, -1, -1):
                if player.field[i].current_health <= 0:
                    self.destroy_permanent(owner_index, i)

    def _check_win_conditions(self):
        for i, player in enumerate(self.game.players):
            if player.lives <= 0:
                winner = self.game.players[1 - i]
                self.game.winner = winner.name
                self.game.add_log(f"{winner.name} wins!")

    def _expire_statuses(self, player: PlayerState):
        for permanent in player.field:
            buffs = permanent.statuses.get("temporary_attack_buffs", [])
            remaining = []
            for buff in buffs:
                if buff.get("expires") == "end_of_turn":
                    amount = safe_int(buff.get("amount", 0))
                    permanent.current_attack -= amount
                    self.game.add_log(f"{permanent.card.name}'s +{amount} ATTACK buff expires.")
                else:
                    remaining.append(buff)
            permanent.statuses["temporary_attack_buffs"] = remaining

    def _resolve_delayed_effects(self, player: PlayerState):
        remaining = []
        for effect in player.delayed_effects:
            effect["turns_remaining"] = safe_int(effect.get("turns_remaining", 0)) - 1
            if effect["turns_remaining"] <= 0:
                if effect.get("type") == "gain_spirit":
                    amount = safe_int(effect.get("amount", 0))
                    player.gain_spirit(amount)
                    self.game.add_log(f"{player.name} gains {amount} Spirit from delayed effect.")
            else:
                remaining.append(effect)
        player.delayed_effects = remaining


@effects.register("DAMAGE_ALL_OPPONENT_WARRIORS")
def effect_damage_all_opponent_warriors(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    amount = safe_int(card.effect_params.get("amount", 500))
    opponent_index = engine.game.opponent_index
    opponent = engine.game.opponent
    for i in range(len(opponent.field) - 1, -1, -1):
        engine.damage_permanent(opponent_index, i, amount)


@effects.register("DAMAGE_TARGET")
def effect_damage_target(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    amount = safe_int(card.effect_params.get("amount", 500))
    target_player_index = context.get("target_player_index")
    target_field_index = context.get("target_field_index")
    if target_player_index is None or target_field_index is None:
        engine.game.add_log(f"{card.name} requires a target.")
        return
    engine.damage_permanent(target_player_index, target_field_index, amount)


@effects.register("DESTROY_TARGET_WARRIOR")
def effect_destroy_target_warrior(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    target_player_index = context.get("target_player_index")
    target_field_index = context.get("target_field_index")
    if target_player_index is None or target_field_index is None:
        engine.game.add_log(f"{card.name} requires a target Warrior.")
        return
    engine.destroy_permanent(target_player_index, target_field_index)


@effects.register("BUFF_ATTACKING_WARRIOR_THIS_ATTACK")
def effect_buff_attacking_warrior_this_attack(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    attacker = context.get("attacker")
    if attacker is None:
        engine.game.add_log(f"{card.name} requires an attacking Warrior.")
        return
    amount = safe_int(card.effect_params.get("amount", 0))
    engine.buff_attack_for_this_attack(attacker, amount)


@effects.register("HEAL_TARGET")
def effect_heal_target(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    amount = safe_int(card.effect_params.get("amount", 500))
    target_player_index = context.get("target_player_index", context.get("player_index"))
    target_field_index = context.get("target_field_index")
    if target_player_index is None or target_field_index is None:
        engine.game.add_log(f"{card.name} requires a target Warrior.")
        return
    engine.heal_permanent(target_player_index, target_field_index, amount)


@effects.register("HEAL_ALL_YOUR_WARRIORS")
def effect_heal_all_your_warriors(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    amount = safe_int(card.effect_params.get("amount", 750))
    player_index = context.get("player_index", engine.game.current_player_index)
    player = engine.game.player(player_index)
    for i in range(len(player.field)):
        engine.heal_permanent(player_index, i, amount)


@effects.register("GAIN_SPIRIT")
def effect_gain_spirit(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    amount = safe_int(card.effect_params.get("amount", 1))

    # Beta correction: this card costs 1 Spirit to activate, so it must gain 2 Spirit
    # to function as a meaningful replenishing Item.
    if normalize_key(card.name) == "best-friends-bond":
        amount = 2

    player_index = context.get("player_index", engine.game.current_player_index)
    engine.game.player(player_index).gain_spirit(amount)
    engine.game.add_log(f"{engine.game.player(player_index).name} gains {amount} Spirit.")


@effects.register("LOSE_OPPONENT_SPIRIT")
def effect_lose_opponent_spirit(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    amount = safe_int(card.effect_params.get("amount", 1))
    engine.game.opponent.lose_spirit(amount)
    engine.game.add_log(f"{engine.game.opponent.name} loses {amount} Spirit.")


@effects.register("SPIRIT_ESCROW")
def effect_spirit_escrow(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    player_index = context.get("player_index", engine.game.current_player_index)
    player = engine.game.player(player_index)
    amount_in = safe_int(card.effect_params.get("amount", card.effect_params.get("amount_in", 1)))
    amount_out = safe_int(card.effect_params.get("secondaryAmount", card.effect_params.get("amount_out", 3)))
    turns = safe_int(card.effect_params.get("turns", 3))

    if player.spirit >= amount_in:
        player.spend_spirit(amount_in)
        player.delayed_effects.append({"type": "gain_spirit", "amount": amount_out, "turns_remaining": turns})
        engine.game.add_log(f"{player.name} places {amount_in} Spirit in escrow. Payout: {amount_out} Spirit in {turns} turns.")
    else:
        engine.game.add_log(f"{player.name} cannot place Spirit in escrow; not enough Spirit after paying card cost.")


@effects.register("SEARCH_DECK")
def effect_search_deck(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    player_index = context.get("player_index", engine.game.current_player_index)
    card_type, faction = engine._infer_search_constraints(card)
    engine.search_deck_to_hand(player_index, card_type=card_type, faction=faction)


@effects.register("REVIVE_WARRIOR")
def effect_revive_warrior(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    player_index = context.get("player_index", engine.game.current_player_index)
    player = engine.game.player(player_index)

    for i, out_card in enumerate(player.out_deck):
        if out_card.type == CardType.WARRIOR.value:
            revived = player.out_deck.pop(i)
            player.field.append(Permanent.from_card(revived, player_index))
            engine.game.add_log(f"{player.name} revives {revived.name} from the Out deck.")
            return

    engine.game.add_log(f"{player.name} has no Warrior in the Out deck to revive.")


@effects.register("NO_ATTACKS_NEXT_TURN")
def effect_no_attacks_next_turn(engine: RulesEngine, card: Card, context: Dict[str, Any]):
    opponent = engine.game.opponent
    opponent.statuses["no_attacks"] = {"turns_remaining": 1}
    engine.game.add_log(f"{opponent.name} cannot attack next turn. [Handler placeholder]")


def load_cards_from_json(json_path: str) -> List[Card]:
    with open(json_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("cards") or raw.get("data") or raw.get("rows") or []
    else:
        raise ValueError("JSON must be a card list or an object containing cards/data/rows.")

    return [Card.from_dict(row) for row in rows if isinstance(row, dict)]


def build_pool(cards: List[Card]) -> Dict[str, Card]:
    pool: Dict[str, Card] = {}
    for card in cards:
        pool[card.id] = card
        pool[card.slug] = card
        pool[normalize_key(card.name)] = card
    return pool


def build_deck_by_names(cards: List[Card], names: List[str]) -> List[Card]:
    pool = build_pool(cards)
    deck: List[Card] = []

    for name in names:
        key = normalize_key(name)
        card = pool.get(name) or pool.get(key)
        if not card:
            raise ValueError(f"Card not found: {name}")
        deck.append(card.clone())

    return deck



def _raw_field(card: Card, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if isinstance(card.raw, dict) and key in card.raw and card.raw[key] not in (None, ""):
            return card.raw[key]
    return default


def _split_tags(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str):
        return [x.strip() for x in re.split(r"[,;|]", value) if x.strip()]
    return [str(value).strip()] if str(value).strip() else []


def _support_factions_for_card(card: Card) -> List[str]:
    """
    Returns faction restrictions for Neutral support cards.

    Example:
    - Flame Training is faction='Neutral', but it supports Monk Warriors.
    - Therefore it is legal in Monk decks only and blocked from Dwarf decks.
    """
    explicit_support = _raw_field(card, "supportFaction", "support_faction", default="")
    tags = _split_tags(_raw_field(card, "deckTags", "deck_tags", default=[]))

    factions = {"monk", "dwarf", "sonic", "surfer", "shaman"}
    found = set()

    for value in [explicit_support, *tags]:
        key = normalize_key(value)
        if key in factions:
            found.add(key)

    if found:
        return sorted(found)

    text_parts = [
        card.name,
        card.rules_text,
        card.effect_key,
        str(card.effect_params),
        json.dumps(card.effects, ensure_ascii=False) if card.effects else "",
    ]
    text = normalize_key(" ".join(text_parts))

    for faction in factions:
        if faction in text:
            found.add(faction)

    return sorted(found)


def _card_allowed_in_faction_deck(card: Card, faction: str) -> bool:
    fkey = normalize_key(faction)

    if card.type in {CardType.WARRIOR.value, CardType.ATTACK.value}:
        return normalize_key(card.faction) == fkey

    if normalize_key(card.faction) != "neutral":
        return normalize_key(card.faction) == fkey

    support_factions = _support_factions_for_card(card)

    if not support_factions:
        return True

    return fkey in support_factions


def _repeat_to_count(pool: List[Card], count: int) -> List[Card]:
    if not pool or count <= 0:
        return []
    return [pool[i % len(pool)].clone() for i in range(count)]


def build_sample_deck(cards: List[Card], faction: str, deck_size: int = 30) -> List[Card]:
    """
    Builds a faction-clean beta deck.

    Rules:
    - Warriors: only chosen faction.
    - Attacks: only chosen faction.
    - True Neutral Items/Weapons: allowed everywhere.
    - Faction-specific Neutral support only goes in the matching faction deck.
      Example: Flame Training is Neutral but Monk-only, so it cannot enter Dwarf decks.
    """
    allowed = [c for c in cards if _card_allowed_in_faction_deck(c, faction)]

    warriors = [c for c in allowed if c.type == CardType.WARRIOR.value]
    attacks = [c for c in allowed if c.type == CardType.ATTACK.value]
    items = [c for c in allowed if c.type == CardType.ITEM.value]
    weapons = [c for c in allowed if c.type == CardType.WEAPON.value]

    if not warriors:
        raise ValueError(f"No Warrior cards found for faction: {faction}")

    plan = [
        (warriors, min(15, deck_size)),
        (attacks, min(5, max(0, deck_size - 15))),
        (items, min(5, max(0, deck_size - 20))),
        (weapons, min(5, max(0, deck_size - 25))),
    ]

    deck: List[Card] = []
    for pool, count in plan:
        deck.extend(_repeat_to_count(pool, count))

    filler = warriors + attacks + items + weapons
    while len(deck) < deck_size:
        deck.append(filler[len(deck) % len(filler)].clone())

    return deck[:deck_size]


def describe_card(card: Card) -> str:
    if card.type == CardType.WARRIOR.value:
        return f"{card.name} [{card.faction} Warrior] Cost:{card.spirit_cost} ATK:{card.attack} HP:{card.health}"
    return f"{card.name} [{card.faction} {card.type}] Cost:{card.spirit_cost} Text:{card.rules_text}"


def describe_permanent(permanent: Permanent) -> str:
    weapons = ""
    if permanent.equipment:
        weapons = " | Weapon: " + ", ".join(w.name for w in permanent.equipment)

    return (
        f"{permanent.card.name} "
        f"ATK:{permanent.current_attack} "
        f"HP:{permanent.current_health}/{permanent.max_health} "
        f"{'(exhausted)' if permanent.exhausted else ''}"
        f"{weapons}"
    )
