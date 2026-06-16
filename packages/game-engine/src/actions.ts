import type { Card } from "@euphoria/card-data";
import {
  defaultEffectRegistry,
  normalizeEffectCode,
  type EffectRegistry,
} from "./effects";
import {
  addWarriorAttackDisable,
  attackDamageMultiplier,
  findAttackDamageHalving,
  findAttackPreventionStatus,
  findAttackTargetProtection,
  findAttackerRestriction,
  findDuelPartner,
  findRetaliationStatuses,
  recordAttackDeclaration,
  retaliationHealthLoss,
} from "./status";
import {
  createWarriorInPlay,
  destroyWarrior,
  opponentOf,
  runEndPhase,
} from "./turn";
import type { GameAction, GameState, PlayerId, WarriorInPlay } from "./types";

export type EngineErrorCode =
  | "WRONG_PHASE"
  | "GAME_OVER"
  | "NOT_IMPLEMENTED"
  | "CARD_NOT_IN_HAND"
  | "WRONG_CARD_TYPE"
  | "INSUFFICIENT_SPIRIT"
  | "FIELD_FULL"
  | "SUMMON_LIMIT_REACHED"
  | "WARRIOR_NOT_FOUND"
  | "WEAPON_ALREADY_EQUIPPED"
  | "FIRST_TURN_NO_ATTACKS"
  | "WARRIOR_EXHAUSTED"
  | "OPPONENT_HAS_WARRIORS"
  | "DIRECT_ATTACK_LIMIT"
  | "ATTACK_CARD_CHOICE_REQUIRED"
  | "ATTACK_CARD_INCOMPATIBLE"
  | "ATTACKS_PREVENTED"
  | "ATTACK_TARGET_PROTECTED"
  | "ATTACKER_RESTRICTED"
  | "FORCED_DUEL_TARGET";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: EngineError };

function fail(code: EngineErrorCode, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

/**
 * Attack-card effects that replace the normal combat hit with their own
 * damage (the handler deals it), so the declared defender is not
 * double-counted. Silurian Period's lingering tick and Gylippus's flat
 * damage both land this way.
 */
const REPLACE_COMBAT_EFFECTS = new Set([
  "LINGERING_EXISTING_DAMAGE",
  "GYLIPPUS",
  // Decimation is a board-wide Finisher: its stone draw stands in for the
  // declared attack, so the normal combat hit is skipped.
  "DECIMATION",
]);

/**
 * Pure action reducer: validates, then returns a new state (the input state
 * is never mutated). Illegal actions return a typed error instead of throwing.
 */
export function applyAction(
  state: GameState,
  action: GameAction,
  effects: EffectRegistry = defaultEffectRegistry,
): ActionResult {
  if (state.winner !== null) {
    return fail("GAME_OVER", `The game is over; ${state.winner} won.`);
  }

  switch (action.kind) {
    case "playWarrior":
      return playWarrior(state, action.cardId);
    case "playItem":
      return playItem(state, action, effects);
    case "equipWeapon":
      return equipWeapon(state, action.cardId, action.warriorInstanceId, effects);
    case "attack":
      return attackWarrior(state, action, effects);
    case "directAttack":
      return directAttack(state, action.attackerInstanceId);
    case "reclaimWarrior":
      return reclaimWarrior(state, action.warriorInstanceId);

    case "enterBattle": {
      if (state.phase !== "main") {
        return fail(
          "WRONG_PHASE",
          `Battle Phase can only be entered from Main Phase (current: ${state.phase}).`,
        );
      }
      const next = structuredClone(state);
      next.phase = "battle";
      next.events.push({ type: "phaseChanged", phase: "battle" });
      return { ok: true, state: next };
    }

    case "endTurn": {
      if (state.phase !== "main" && state.phase !== "battle") {
        return fail(
          "WRONG_PHASE",
          `The turn can only be ended from Main or Battle Phase (current: ${state.phase}).`,
        );
      }
      const next = structuredClone(state);
      runEndPhase(next);
      return { ok: true, state: next };
    }

    default:
      return fail(
        "NOT_IMPLEMENTED",
        `Action "${(action as GameAction).kind}" is not implemented yet.`,
      );
  }
}

/** Shared gates for declaring any attack with one of your Warriors. */
function validateAttacker(
  state: GameState,
  attackerInstanceId: string,
): { attacker: WarriorInPlay } | { error: ActionResult } {
  if (state.phase !== "battle") {
    return {
      error: fail(
        "WRONG_PHASE",
        `Attacks can only be declared in Battle Phase (current: ${state.phase}).`,
      ),
    };
  }
  if (state.config.noAttacksOnFirstTurn && state.turn === 1) {
    return {
      error: fail(
        "FIRST_TURN_NO_ATTACKS",
        "No attacks are allowed on the first turn of the game.",
      ),
    };
  }
  // Gorgon's Eye blocks all attack declarations, the controller's included.
  if (findAttackPreventionStatus(state) !== undefined) {
    return {
      error: fail(
        "ATTACKS_PREVENTED",
        "No attacks can be declared while an attack-prevention status is active.",
      ),
    };
  }
  const attacker = state.players[state.activePlayer].field.find(
    (w) => w.instanceId === attackerInstanceId,
  );
  if (attacker === undefined) {
    return {
      error: fail(
        "WARRIOR_NOT_FOUND",
        `${state.activePlayer} controls no Warrior "${attackerInstanceId}".`,
      ),
    };
  }
  // Primetime Interview: a different Warrior is the only one allowed to attack.
  if (
    findAttackerRestriction(state, state.activePlayer, attackerInstanceId) !==
    undefined
  ) {
    return {
      error: fail(
        "ATTACKER_RESTRICTED",
        `${attacker.card.name} cannot attack: another Warrior is currently the only one that can attack.`,
      ),
    };
  }
  if (attacker.attacksRemaining <= 0) {
    return {
      error: fail(
        "WARRIOR_EXHAUSTED",
        `${attacker.card.name} has no attacks remaining this turn.`,
      ),
    };
  }
  return { attacker };
}

/**
 * An Attack card is compatible only with Warriors of its own faction.
 * Neutral Attack cards are not compatible with anyone unless the card data
 * explicitly allows it — no field grants that today (the current set has no
 * Neutral Attack cards), so this is the single place to extend if one lands.
 */
export function isAttackCardCompatible(
  card: Card,
  attackerFaction: Card["faction"],
): boolean {
  return card.type === "Attack" && card.faction === attackerFaction;
}

/**
 * Compatible AND usable right now: in the active player's hand, same
 * faction as the attacker, and affordable. Deduped by card id.
 */
export function getCompatibleAttackCards(
  state: GameState,
  attackerInstanceId: string,
): Card[] {
  const player = state.players[state.activePlayer];
  const attacker = player.field.find((w) => w.instanceId === attackerInstanceId);
  if (attacker === undefined) return [];

  const seen = new Set<string>();
  const compatible: Card[] = [];
  for (const card of player.hand) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    if (!isAttackCardCompatible(card, attacker.card.faction)) continue;
    if (card.cost > player.spirit) continue;
    compatible.push(card);
  }
  return compatible;
}

function attachedWeaponCode(warrior: WarriorInPlay): string | undefined {
  const code = warrior.attachedWeapon?.effectCode;
  return code === undefined ? undefined : normalizeEffectCode(code);
}

/** Warriors only ever reach the Out Deck by being destroyed, so the
 *  destroyed-friendly-Warrior count is exactly the Warrior cards there. */
function destroyedFriendlyWarriorCount(state: GameState, owner: PlayerId): number {
  return state.players[owner].outDeck.filter((c) => c.type === "Warrior").length;
}

/**
 * Combat damage with Weapon combat passives applied. Passives are read
 * straight from the attached Weapon card: Weapons never detach and go to
 * the Out Deck with their Warrior, so attachment is exactly the passive's
 * lifetime. The attacker's outgoing modifiers apply first (Apotheosis
 * overrides the damage to a fraction of the defender's HEALTH; Xīwànghǎo
 * adds the attack difference; Armageddon adds a per-destroyed-friendly-
 * Warrior bonus, recomputed each attack so it tracks the growing Out Deck),
 * then the defender's incoming one (Skeleton Key halves what arrives). A
 * Warrior holds at most one Weapon, so the attacker branches are mutually
 * exclusive.
 */
function computeCombatDamage(
  state: GameState,
  attackerOwner: PlayerId,
  attacker: WarriorInPlay,
  defender: WarriorInPlay,
): number {
  let damage = attacker.currentAttack;
  // Apotheosis: the damage inflicted is always a fraction (half) of the
  // defender's current HEALTH, replacing the attack-based amount.
  if (attachedWeaponCode(attacker) === "WEAPON_HALF_HEALTH_DAMAGE") {
    const fraction = attacker.attachedWeapon?.effectParams?.["amount"];
    const multiplier =
      typeof fraction === "number" && fraction > 0 && fraction < 1 ? fraction : 0.5;
    damage = Math.floor(defender.currentHealth * multiplier);
  }
  if (attachedWeaponCode(attacker) === "WEAPON_ADD_ATTACK_DIFFERENCE_DAMAGE") {
    damage += Math.abs(attacker.currentAttack - defender.currentAttack);
  }
  // Gilgamesh: vs a defender with higher ATTACK, the equipped Warrior gains
  // the difference for the battle — so the hit lands at the higher ATTACK.
  if (attachedWeaponCode(attacker) === "WEAPON_EQUALIZE_VS_HIGHER_ATTACK") {
    if (defender.currentAttack > attacker.currentAttack) {
      damage += defender.currentAttack - attacker.currentAttack;
    }
  }
  if (attachedWeaponCode(attacker) === "WEAPON_ATTACK_PER_DESTROYED_FRIENDLY") {
    const perWarrior = attacker.attachedWeapon?.effectParams?.["amount"];
    const amount = typeof perWarrior === "number" ? perWarrior : 250;
    damage += amount * destroyedFriendlyWarriorCount(state, attackerOwner);
  }
  if (attachedWeaponCode(defender) === "WEAPON_HALVE_INCOMING_DAMAGE") {
    const amount = defender.attachedWeapon?.effectParams?.["amount"];
    const multiplier =
      typeof amount === "number" && amount > 0 && amount < 1 ? amount : 0.5;
    damage = Math.floor(damage * multiplier);
  }
  // Bitter Guard: the attacking player's combat damage is cut to a fraction
  // (half) for the duration of the status — applied last, to the final hit.
  const halving = findAttackDamageHalving(state, attackerOwner);
  if (halving !== undefined) {
    damage = Math.floor(damage * attackDamageMultiplier(halving));
  }
  return damage;
}

/**
 * Moirai's on-attack grant: when the equipped Warrior attacks, you may
 * give one *other* friendly Warrior an extra Warrior-vs-Warrior attack
 * this turn, via the shared attacksRemaining plumbing (cf.
 * EXTRA_ATTACK_THIS_TURN). The card text — "a Warrior not equipped with
 * this card" — forbids targeting the equipped Warrior itself; enemy,
 * missing, invalid, and self targets grant nothing. Every reject path
 * returns silently so the attack that triggered it stays intact. The
 * granted attack rides attacksRemaining, so it lapses at the next refresh.
 */
function grantOtherWarriorExtraAttack(
  state: GameState,
  attackingPlayer: PlayerId,
  attackerInstanceId: string,
  targetInstanceId: string | undefined,
): void {
  if (targetInstanceId === undefined) return; // optional grant, none chosen
  if (targetInstanceId === attackerInstanceId) return; // cannot target itself
  const target = state.players[attackingPlayer].field.find(
    (w) => w.instanceId === targetInstanceId,
  );
  if (target === undefined) return; // invalid id, or an enemy Warrior
  target.attacksRemaining += 1;
  state.events.push({
    type: "extraAttackGranted",
    player: attackingPlayer,
    instanceId: target.instanceId,
    amount: 1,
    attacksRemaining: target.attacksRemaining,
  });
}

/**
 * Scythe Cycle's on-attack splash: when the equipped Warrior attacks and
 * the opponent has more than one Warrior, the chosen enemy Warrior (via the
 * attack's effectTargetInstanceId) takes the Weapon's `amount` of splash
 * damage. Missing, invalid, or friendly targets splash nothing; lethal
 * splash routes through destroyWarrior, moving the slain Warrior and its
 * Weapon to the Out Deck. Only Warrior-vs-Warrior attacks reach here, so
 * direct attacks never trigger it.
 */
function applySelectedEnemySplash(
  state: GameState,
  opponentId: PlayerId,
  amount: number,
  targetInstanceId: string | undefined,
): void {
  if (amount <= 0 || targetInstanceId === undefined) return;
  const target = state.players[opponentId].field.find(
    (w) => w.instanceId === targetInstanceId,
  );
  if (target === undefined) return; // invalid id, or a friendly Warrior
  target.currentHealth -= amount;
  state.events.push({
    type: "warriorHealthModified",
    player: opponentId,
    instanceId: target.instanceId,
    amount: -amount,
    newHealth: target.currentHealth,
  });
  if (target.currentHealth <= 0) {
    destroyWarrior(state, opponentId, target.instanceId);
  }
}

function attackWarrior(
  state: GameState,
  action: Extract<GameAction, { kind: "attack" }>,
  effects: EffectRegistry,
): ActionResult {
  const gate = validateAttacker(state, action.attackerInstanceId);
  if ("error" in gate) return gate.error;

  const opponentId = opponentOf(state.activePlayer);
  const declaredDefender = state.players[opponentId].field.find(
    (w) => w.instanceId === action.defenderInstanceId,
  );
  if (declaredDefender === undefined) {
    return fail(
      "WARRIOR_NOT_FOUND",
      `${opponentId} controls no Warrior "${action.defenderInstanceId}" to attack.`,
    );
  }
  // Trial of Gia: a dueling Warrior may only attack its locked opponent.
  const duelPartnerId = findDuelPartner(state, action.attackerInstanceId);
  if (duelPartnerId !== undefined && duelPartnerId !== action.defenderInstanceId) {
    return fail(
      "FORCED_DUEL_TARGET",
      `${gate.attacker.card.name} is locked in a duel and may only attack its dueling opponent.`,
    );
  }
  if (
    findAttackTargetProtection(
      state,
      state.activePlayer,
      opponentId,
      declaredDefender,
    ) !== undefined
  ) {
    return fail(
      "ATTACK_TARGET_PROTECTED",
      `${declaredDefender.card.name} is protected by a status and cannot be attacked this turn.`,
    );
  }

  if (action.selectedAttackCardId !== undefined && action.skipAttackCard === true) {
    return fail(
      "ATTACK_CARD_CHOICE_REQUIRED",
      "Provide either selectedAttackCardId or skipAttackCard: true, not both.",
    );
  }

  // The attack-card window: a choice is required only when one is usable.
  if (
    action.selectedAttackCardId === undefined &&
    action.skipAttackCard !== true &&
    getCompatibleAttackCards(state, action.attackerInstanceId).length > 0
  ) {
    return fail(
      "ATTACK_CARD_CHOICE_REQUIRED",
      "A compatible Attack card is available: select it with selectedAttackCardId or pass skipAttackCard: true.",
    );
  }

  if (action.selectedAttackCardId !== undefined) {
    const player = state.players[state.activePlayer];
    const card = player.hand.find((c) => c.id === action.selectedAttackCardId);
    if (card === undefined) {
      return fail(
        "CARD_NOT_IN_HAND",
        `${player.id} has no card "${action.selectedAttackCardId}" in hand.`,
      );
    }
    if (card.type !== "Attack") {
      return fail("WRONG_CARD_TYPE", `${card.name} is not an Attack card.`);
    }
    const attackerFaction = gate.attacker.card.faction;
    if (!isAttackCardCompatible(card, attackerFaction)) {
      return fail(
        "ATTACK_CARD_INCOMPATIBLE",
        `${card.name} (${card.faction}) is not compatible with a ${attackerFaction} Warrior. Attack cards must match the attacker's faction.`,
      );
    }
    if (player.spirit < card.cost) {
      return fail(
        "INSUFFICIENT_SPIRIT",
        `${card.name} costs ${card.cost} Spirit; ${player.id} has ${player.spirit}.`,
      );
    }
  }

  let next = structuredClone(state);

  // Some Attack cards swap the normal combat hit for their own damage, so
  // the declared defender is not double-counted. The "replace" is keyed on
  // the effectCode, not the timing: every Attack card shares timing
  // "on_attack_replace", so it cannot discriminate these.
  let replacesAttack = false;

  if (action.selectedAttackCardId !== undefined) {
    const player = next.players[next.activePlayer];
    const handIndex = player.hand.findIndex(
      (c) => c.id === action.selectedAttackCardId,
    );
    const card = player.hand[handIndex]!;
    replacesAttack =
      card.effectCode !== undefined &&
      REPLACE_COMBAT_EFFECTS.has(normalizeEffectCode(card.effectCode));
    player.spirit -= card.cost;
    player.hand.splice(handIndex, 1);
    player.outDeck.push(card);
    next.events.push({
      type: "attackCardUsed",
      player: player.id,
      cardId: card.id,
      attackerInstanceId: action.attackerInstanceId,
      cost: card.cost,
    });

    // Resolve the card's effect before combat damage. An unknown or failed
    // effect never aborts the attack or corrupts state: the cost stays paid
    // (per project decision) and the card is marked as pending a handler.
    const resolution = effects.resolve(next, card, {
      player: next.activePlayer,
      attackerInstanceId: action.attackerInstanceId,
      defenderInstanceId: action.defenderInstanceId,
      targetInstanceId: action.effectTargetInstanceId,
    });
    if (resolution.outcome.resolved) {
      next = resolution.state;
    } else {
      next.events.push({
        type: "effectNotImplemented",
        player: player.id,
        cardId: card.id,
      });
    }
  }

  // Re-find both Warriors: the effect may have destroyed the defender.
  const attacker = next.players[next.activePlayer].field.find(
    (w) => w.instanceId === action.attackerInstanceId,
  );
  const defender = next.players[opponentId].field.find(
    (w) => w.instanceId === action.defenderInstanceId,
  );
  if (attacker !== undefined) {
    attacker.attacksRemaining -= 1;
    // After-attack-declaration hook (Moral Determination Authrotity).
    recordAttackDeclaration(next, next.activePlayer, attacker.instanceId);
  }
  if (attacker !== undefined && defender !== undefined && !replacesAttack) {
    // The defender's faction drives retaliation even if the attack
    // destroys the defender (it was still "a Monk that was attacked").
    const defenderFaction = defender.card.faction;
    // Scythe Cycle checks "opponent has more than 1 Warrior" at attack
    // time, before combat damage can thin the field.
    const opponentCountBeforeCombat = next.players[opponentId].field.length;
    // The attacker takes no counter damage (CLAUDE.md overrides the spec's
    // "simultaneous" wording; see RulesConfig.combatDamageSimultaneous).
    let damage = computeCombatDamage(next, next.activePlayer, attacker, defender);
    // Ontology (WEAPON_NEGATE_ONCE_REDUCE_ATTACKER): the equipped Warrior
    // negates the first attack against it each turn (keyed on the unique turn
    // number), and any Warrior that attacks it loses ATTACK. Both clauses are
    // independent — a negated attack still debuffs the attacker.
    if (attachedWeaponCode(defender) === "WEAPON_NEGATE_ONCE_REDUCE_ATTACKER") {
      if (defender.negatedAttackTurn !== next.turn) {
        defender.negatedAttackTurn = next.turn;
        damage = 0;
        next.events.push({
          type: "attackNegated",
          player: opponentId,
          instanceId: defender.instanceId,
          attackerInstanceId: attacker.instanceId,
        });
      }
      const reduction = defender.attachedWeapon?.effectParams?.["secondaryAmount"];
      const loss = typeof reduction === "number" ? Math.abs(reduction) : 500;
      const newAttack = Math.max(0, attacker.currentAttack - loss);
      if (newAttack !== attacker.currentAttack) {
        next.events.push({
          type: "warriorAttackModified",
          player: next.activePlayer,
          instanceId: attacker.instanceId,
          amount: newAttack - attacker.currentAttack,
          newAttack,
        });
        attacker.currentAttack = newAttack;
      }
    }
    defender.currentHealth -= damage;
    next.events.push({
      type: "warriorAttacked",
      player: next.activePlayer,
      attackerInstanceId: attacker.instanceId,
      defenderInstanceId: defender.instanceId,
      damage,
    });
    if (defender.currentHealth <= 0) {
      // Jesus (WEAPON_ATTACK_BONUS_LEAVE_AT_ONE): a Warrior attacked by the
      // equipped Warrior cannot be destroyed by the battle — a lethal hit
      // leaves its HEALTH at the Weapon's floor (1) instead. Read live from
      // the attacker's attachment, so it stops once the Weapon leaves play.
      if (attachedWeaponCode(attacker) === "WEAPON_ATTACK_BONUS_LEAVE_AT_ONE") {
        const floor = attacker.attachedWeapon?.effectParams?.["secondaryAmount"];
        defender.currentHealth = typeof floor === "number" ? floor : 1;
      } else {
        destroyWarrior(next, opponentId, defender.instanceId);
      }
    }

    // Phobos (WEAPON_DISABLE_ATTACKED_ONE_TURN): a Warrior attacked by the
    // equipped Warrior can't attack for 1 turn. Read straight from the
    // attacker's attached Weapon (attachment == passive lifetime). A
    // destroyed defender gets no disable — it has left the field, so the
    // status would only fizzle. Direct attacks never reach here, so they
    // never trigger this defender-specific passive.
    if (attachedWeaponCode(attacker) === "WEAPON_DISABLE_ATTACKED_ONE_TURN") {
      const stillFielded = next.players[opponentId].field.some(
        (w) => w.instanceId === defender.instanceId,
      );
      if (stillFielded) {
        addWarriorAttackDisable(
          next,
          next.activePlayer,
          opponentId,
          defender.instanceId,
          1,
        );
      }
    }

    // Moirai (WEAPON_GRANT_OTHER_EXTRA_ATTACK): the equipped Warrior's
    // attack lets you grant one other friendly Warrior an extra attack
    // this turn (the choice rides the attack's effectTargetInstanceId).
    // Only Warrior-vs-Warrior attacks reach here, so direct attacks never
    // trigger it.
    if (attachedWeaponCode(attacker) === "WEAPON_GRANT_OTHER_EXTRA_ATTACK") {
      grantOtherWarriorExtraAttack(
        next,
        next.activePlayer,
        attacker.instanceId,
        action.effectTargetInstanceId,
      );
    }

    // Scythe Cycle (WEAPON_ATTACK_BONUS_SPLASH): when the equipped Warrior
    // attacks and the opponent had more than one Warrior, the chosen enemy
    // Warrior (the attack's effectTargetInstanceId) takes the Weapon's
    // splash damage. Read live from the attachment, so it stops once the
    // equipped Warrior dies and the Weapon leaves with it.
    if (
      attachedWeaponCode(attacker) === "WEAPON_ATTACK_BONUS_SPLASH" &&
      opponentCountBeforeCombat > 1
    ) {
      const splash = attacker.attachedWeapon?.effectParams?.["secondaryAmount"];
      const amount = typeof splash === "number" ? splash : 500;
      applySelectedEnemySplash(
        next,
        opponentId,
        amount,
        action.effectTargetInstanceId,
      );
    }

    // After-damage-resolution hook (A Dragon's Judgement): each active
    // retaliation status costs the attacker health, possibly killing it.
    for (const retaliation of findRetaliationStatuses(next, defenderFaction)) {
      const stillFielded = next.players[next.activePlayer].field.some(
        (w) => w.instanceId === attacker.instanceId,
      );
      if (!stillFielded) break;
      const loss = retaliationHealthLoss(retaliation);
      if (loss <= 0) continue;
      attacker.currentHealth -= loss;
      next.events.push({
        type: "warriorHealthModified",
        player: next.activePlayer,
        instanceId: attacker.instanceId,
        amount: -loss,
        newHealth: attacker.currentHealth,
      });
      if (attacker.currentHealth <= 0) {
        destroyWarrior(next, next.activePlayer, attacker.instanceId);
      }
    }
  }
  return { ok: true, state: next };
}

function directAttack(state: GameState, attackerInstanceId: string): ActionResult {
  const gate = validateAttacker(state, attackerInstanceId);
  if ("error" in gate) return gate.error;

  // Trial of Gia: a dueling Warrior must attack its locked opponent, never
  // the player directly. (Its opponent is on the field, so the no-Warriors
  // rule below already blocks this; the explicit guard keeps the reason clear.)
  if (findDuelPartner(state, attackerInstanceId) !== undefined) {
    return fail(
      "FORCED_DUEL_TARGET",
      "A Warrior locked in a duel cannot make a direct attack.",
    );
  }
  const opponentId = opponentOf(state.activePlayer);
  if (state.players[opponentId].field.length > 0) {
    return fail(
      "OPPONENT_HAS_WARRIORS",
      "Direct attacks are only allowed when the opponent controls no Warriors.",
    );
  }
  if (state.players[state.activePlayer].directAttackUsedThisTurn) {
    return fail(
      "DIRECT_ATTACK_LIMIT",
      `Only ${state.config.directAttackLimitPerTurn} direct attack is allowed per turn.`,
    );
  }

  const next = structuredClone(state);
  const player = next.players[next.activePlayer];
  const opponent = next.players[opponentId];
  const attacker = player.field.find((w) => w.instanceId === attackerInstanceId)!;

  attacker.attacksRemaining -= 1;
  // After-attack-declaration hook (Moral Determination Authrotity).
  recordAttackDeclaration(next, next.activePlayer, attackerInstanceId);
  player.directAttackUsedThisTurn = true;
  opponent.lives -= 1;
  next.events.push({
    type: "directAttacked",
    player: player.id,
    attackerInstanceId,
    livesRemaining: opponent.lives,
  });

  if (opponent.lives <= 0) {
    next.winner = player.id;
    next.events.push({ type: "gameWon", winner: player.id });
  }
  return { ok: true, state: next };
}

/**
 * Coerced Loyalty buyback: the original owner takes a stolen Warrior back on
 * their own Main Phase, paying the buyback HEALTH cost. The Warrior returns to
 * the owner's field, then takes the damage — which may destroy it (sending its
 * card to the owner's Out Deck via destroyWarrior).
 */
function reclaimWarrior(
  state: GameState,
  warriorInstanceId: string,
): ActionResult {
  if (state.phase !== "main") {
    return fail(
      "WRONG_PHASE",
      `A Warrior can only be reclaimed in Main Phase (current: ${state.phase}).`,
    );
  }
  const ownerId = state.activePlayer;
  const thiefId = opponentOf(ownerId);
  const held = state.players[thiefId].field.find(
    (w) => w.instanceId === warriorInstanceId && w.stolenFrom === ownerId,
  );
  if (held === undefined) {
    return fail(
      "WARRIOR_NOT_FOUND",
      `${ownerId} has no Warrior "${warriorInstanceId}" stolen by ${thiefId} to reclaim.`,
    );
  }
  if (state.players[ownerId].field.length >= state.config.warriorSlots) {
    return fail(
      "FIELD_FULL",
      `${ownerId}'s Warrior field is full (${state.config.warriorSlots} slots); there is no room to reclaim.`,
    );
  }

  const next = structuredClone(state);
  const index = next.players[thiefId].field.findIndex(
    (w) => w.instanceId === warriorInstanceId,
  );
  const [warrior] = next.players[thiefId].field.splice(index, 1);
  const buyback = warrior!.stealBuybackDamage ?? 0;
  warrior!.stolenFrom = undefined;
  warrior!.stealBuybackDamage = undefined;
  next.players[ownerId].field.push(warrior!);
  next.events.push({
    type: "warriorControlReclaimed",
    player: ownerId,
    fromPlayer: thiefId,
    instanceId: warrior!.instanceId,
    cardId: warrior!.card.id,
    newHealth: warrior!.currentHealth,
  });

  // Pay the cost: the reclaimed Warrior takes the buyback damage.
  warrior!.currentHealth -= buyback;
  next.events.push({
    type: "warriorHealthModified",
    player: ownerId,
    instanceId: warrior!.instanceId,
    amount: -buyback,
    newHealth: warrior!.currentHealth,
  });
  if (warrior!.currentHealth <= 0) {
    destroyWarrior(next, ownerId, warrior!.instanceId);
  }
  return { ok: true, state: next };
}

/**
 * Shared validation for playing a card from the active player's hand during
 * Main Phase. Returns the hand index on success.
 */
function validateMainPhasePlay(
  state: GameState,
  cardId: string,
  expectedType: "Warrior" | "Item" | "Weapon",
  verb: string,
): { handIndex: number } | { error: ActionResult } {
  if (state.phase !== "main") {
    return {
      error: fail(
        "WRONG_PHASE",
        `${expectedType}s can only be ${verb} in Main Phase (current: ${state.phase}).`,
      ),
    };
  }
  const player = state.players[state.activePlayer];
  const handIndex = player.hand.findIndex((c) => c.id === cardId);
  if (handIndex === -1) {
    return {
      error: fail(
        "CARD_NOT_IN_HAND",
        `${state.activePlayer} has no card "${cardId}" in hand.`,
      ),
    };
  }
  const card = player.hand[handIndex]!;
  if (card.type !== expectedType) {
    return {
      error: fail("WRONG_CARD_TYPE", `${card.name} is not a ${expectedType}.`),
    };
  }
  if (player.spirit < card.cost) {
    return {
      error: fail(
        "INSUFFICIENT_SPIRIT",
        `${card.name} costs ${card.cost} Spirit; ${player.id} has ${player.spirit}.`,
      ),
    };
  }
  return { handIndex };
}

function playWarrior(state: GameState, cardId: string): ActionResult {
  const validated = validateMainPhasePlay(state, cardId, "Warrior", "summoned");
  if ("error" in validated) return validated.error;

  const player = state.players[state.activePlayer];
  if (player.field.length >= state.config.warriorSlots) {
    return fail(
      "FIELD_FULL",
      `The Warrior field is full (${state.config.warriorSlots} slots).`,
    );
  }
  // One normal Warrior summon per turn. Effect/revive summons do not pass
  // through this action, so they are unaffected by this limit.
  if (player.warriorSummonsUsedThisTurn >= state.config.warriorSummonsPerTurn) {
    return fail(
      "SUMMON_LIMIT_REACHED",
      `Only ${state.config.warriorSummonsPerTurn} Warrior summon` +
        `${state.config.warriorSummonsPerTurn === 1 ? "" : "s"} allowed per turn.`,
    );
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[next.activePlayer];
  const card = nextPlayer.hand[validated.handIndex]!;

  nextPlayer.spirit -= card.cost;
  nextPlayer.hand.splice(validated.handIndex, 1);
  nextPlayer.warriorSummonsUsedThisTurn += 1;

  const warrior = createWarriorInPlay(next, card);
  nextPlayer.field.push(warrior);

  next.events.push({
    type: "warriorSummoned",
    player: nextPlayer.id,
    cardId: card.id,
    instanceId: warrior.instanceId,
    cost: card.cost,
  });
  return { ok: true, state: next };
}

function playItem(
  state: GameState,
  action: Extract<GameAction, { kind: "playItem" }>,
  effects: EffectRegistry,
): ActionResult {
  const validated = validateMainPhasePlay(state, action.cardId, "Item", "played");
  if ("error" in validated) return validated.error;

  let next = structuredClone(state);
  const nextPlayer = next.players[next.activePlayer];
  const card = nextPlayer.hand[validated.handIndex]!;

  nextPlayer.spirit -= card.cost;
  nextPlayer.hand.splice(validated.handIndex, 1);

  next.events.push({
    type: "itemPlayed",
    player: nextPlayer.id,
    cardId: card.id,
    cost: card.cost,
  });

  // Resolve while the Item is in limbo (not yet in the Out Deck), so
  // effects that count Out Deck Items never count the resolving card.
  // Per project decision, the Item is spent whether or not its effect
  // resolves; unknown or failed effects just leave the pending marker.
  const resolution = effects.resolve(next, card, {
    player: next.activePlayer,
    targetInstanceId: action.targetInstanceId,
    secondaryTargetInstanceId: action.secondaryTargetInstanceId,
    targetOutDeckCardId: action.targetOutDeckCardId,
    targetDeckCardId: action.targetDeckCardId,
    targetOpponentHandCardId: action.targetOpponentHandCardId,
  });
  if (resolution.outcome.resolved) {
    next = resolution.state;
  } else {
    next.events.push({
      type: "effectNotImplemented",
      player: nextPlayer.id,
      cardId: card.id,
    });
  }
  next.players[next.activePlayer].outDeck.push(card);
  return { ok: true, state: next };
}

function equipWeapon(
  state: GameState,
  cardId: string,
  warriorInstanceId: string,
  effects: EffectRegistry,
): ActionResult {
  const validated = validateMainPhasePlay(state, cardId, "Weapon", "equipped");
  if ("error" in validated) return validated.error;

  const player = state.players[state.activePlayer];
  const warrior = player.field.find((w) => w.instanceId === warriorInstanceId);
  if (warrior === undefined) {
    return fail(
      "WARRIOR_NOT_FOUND",
      `${player.id} controls no Warrior "${warriorInstanceId}". Weapons can only be equipped to your own Warriors.`,
    );
  }
  if (state.config.oneWeaponPerWarrior && warrior.attachedWeapon !== undefined) {
    return fail(
      "WEAPON_ALREADY_EQUIPPED",
      `${warrior.card.name} already has a Weapon. Weapons cannot be replaced or moved.`,
    );
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[next.activePlayer];
  const card = nextPlayer.hand[validated.handIndex]!;
  const nextWarrior = nextPlayer.field.find(
    (w) => w.instanceId === warriorInstanceId,
  )!;

  nextPlayer.spirit -= card.cost;
  nextPlayer.hand.splice(validated.handIndex, 1);
  nextWarrior.attachedWeapon = card;

  next.events.push({
    type: "weaponEquipped",
    player: nextPlayer.id,
    cardId: card.id,
    warriorInstanceId,
    cost: card.cost,
  });

  // The registry only holds equip-time-safe Weapon handlers (static stat
  // bonuses, safe because Weapons never detach). Combat-hook passives are
  // not registered, so they fall through to the pending marker.
  if (card.effectCode !== undefined) {
    const resolution = effects.resolve(next, card, {
      player: nextPlayer.id,
      targetInstanceId: warriorInstanceId,
    });
    if (resolution.outcome.resolved) {
      return { ok: true, state: resolution.state };
    }
  }
  next.events.push({
    type: "effectNotImplemented",
    player: nextPlayer.id,
    cardId: card.id,
  });
  return { ok: true, state: next };
}

/** Enumerates the currently legal (implemented) actions. */
export function getLegalActions(state: GameState): GameAction[] {
  if (state.winner !== null) return [];

  const actions: GameAction[] = [];
  if (state.phase === "main") {
    const player = state.players[state.activePlayer];
    const seen = new Set<string>();
    for (const card of player.hand) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      if (card.cost > player.spirit) continue;

      if (card.type === "Warrior") {
        if (
          player.field.length < state.config.warriorSlots &&
          player.warriorSummonsUsedThisTurn < state.config.warriorSummonsPerTurn
        ) {
          actions.push({ kind: "playWarrior", cardId: card.id });
        }
      } else if (card.type === "Item") {
        actions.push({ kind: "playItem", cardId: card.id });
      } else if (card.type === "Weapon") {
        for (const warrior of player.field) {
          if (state.config.oneWeaponPerWarrior && warrior.attachedWeapon) {
            continue;
          }
          actions.push({
            kind: "equipWeapon",
            cardId: card.id,
            warriorInstanceId: warrior.instanceId,
          });
        }
      }
    }
    // Coerced Loyalty: reclaim any of the active player's Warriors the
    // opponent currently controls, as long as there is room on the field.
    if (player.field.length < state.config.warriorSlots) {
      for (const stolen of state.players[opponentOf(state.activePlayer)].field) {
        if (stolen.stolenFrom === state.activePlayer) {
          actions.push({
            kind: "reclaimWarrior",
            warriorInstanceId: stolen.instanceId,
          });
        }
      }
    }
    actions.push({ kind: "enterBattle" });
  }
  if (state.phase === "battle") {
    const player = state.players[state.activePlayer];
    const opponent = state.players[opponentOf(state.activePlayer)];
    const attacksAllowed =
      !(state.config.noAttacksOnFirstTurn && state.turn === 1) &&
      findAttackPreventionStatus(state) === undefined;
    if (attacksAllowed) {
      for (const attacker of player.field) {
        if (attacker.attacksRemaining <= 0) continue;
        if (
          findAttackerRestriction(state, state.activePlayer, attacker.instanceId) !==
          undefined
        ) {
          continue;
        }
        // Trial of Gia: a dueling attacker's only legal target is its partner.
        const duelPartnerId = findDuelPartner(state, attacker.instanceId);
        const attackCards = getCompatibleAttackCards(state, attacker.instanceId);
        for (const defender of opponent.field) {
          if (duelPartnerId !== undefined && defender.instanceId !== duelPartnerId) {
            continue;
          }
          if (
            findAttackTargetProtection(
              state,
              state.activePlayer,
              opponent.id,
              defender,
            ) !== undefined
          ) {
            continue;
          }
          if (attackCards.length === 0) {
            actions.push({
              kind: "attack",
              attackerInstanceId: attacker.instanceId,
              defenderInstanceId: defender.instanceId,
            });
          } else {
            for (const card of attackCards) {
              actions.push({
                kind: "attack",
                attackerInstanceId: attacker.instanceId,
                defenderInstanceId: defender.instanceId,
                selectedAttackCardId: card.id,
              });
            }
            actions.push({
              kind: "attack",
              attackerInstanceId: attacker.instanceId,
              defenderInstanceId: defender.instanceId,
              skipAttackCard: true,
            });
          }
        }
        if (
          opponent.field.length === 0 &&
          !player.directAttackUsedThisTurn &&
          duelPartnerId === undefined
        ) {
          actions.push({
            kind: "directAttack",
            attackerInstanceId: attacker.instanceId,
          });
        }
      }
    }
  }
  if (state.phase === "main" || state.phase === "battle") {
    actions.push({ kind: "endTurn" });
  }
  return actions;
}
