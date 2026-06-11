# Euphoria Rules Engine Missing Files

You already have:

```text
euphoria_rules_engine.py
```

Put these files in the same folder:

```text
C:\Users\Armstrong\Documents\Euphoria\Cards\card_jsonexcel
```

Required to run:

```text
euphoria_rules_engine.py
simulate_game.py
cards_file.json
```

Run:

```bat
cd "C:\Users\Armstrong\Documents\Euphoria\Cards\card_jsonexcel"
python simulate_game.py --json "C:\Users\Armstrong\Documents\Euphoria\Cards\card_jsonexcel\cards_file.json"
```

Optional:

```bat
python simulate_game.py --json "C:\Users\Armstrong\Documents\Euphoria\Cards\card_jsonexcel\cards_file.json" --p1 Monk --p2 Dwarf --seed 7
```
