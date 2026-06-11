# Euphoria Effect Schema v0.1

The engine can read your current `effects` array and infer some generic handlers, but the cleaner long-term path is to add:

```json
"effect_code": "DAMAGE_ALL_OPPONENT_WARRIORS",
"effect_params": {
  "amount": 1000
}
```

## Supported generic effect codes

- DAMAGE_ALL_OPPONENT_WARRIORS
- DAMAGE_TARGET
- DESTROY_TARGET_WARRIOR
- BUFF_ATTACKING_WARRIOR_THIS_ATTACK
- HEAL_TARGET
- HEAL_ALL_YOUR_WARRIORS
- GAIN_SPIRIT
- LOSE_OPPONENT_SPIRIT
- SPIRIT_ESCROW
- SEARCH_DECK
- REVIVE_WARRIOR
- NO_ATTACKS_NEXT_TURN

## Cards likely needing custom handlers later

- Coerced Loyalty
- GILs Unit
- High Tea
- Moral Determination Authrotity
- Slush Fund
- Trial of Gia
- XL-QR517
- Apotheosis
- Gilgamesh
- Jesus
- Moirai
- Ontology
- Phobos
- Xīwànghǎo
- Decimation
