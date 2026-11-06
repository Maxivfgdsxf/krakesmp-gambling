
// KRAKESMP GAMES

async function playGame(game, stake, choice) {
  if (!currentUser) {
    return showMessage("Bitte zuerst einloggen!");
  }

  stake = Number(stake);

  if (!Number.isSafeInteger(stake) || stake <= 0) {
    return showMessage("Ungültiger Einsatz!");
  }

  if (!["coinflip", "horserace", "stocks"].includes(game)) {
    return showMessage("Unbekanntes Spiel!");
  }

  if (typeof choice !== "string" || choice.length > 30) {
    return showMessage("Ungültige Auswahl!");
  }

  const { data, error } = await db.rpc("krake_play_game", {
    p_game: game,
    p_stake: stake,
    p_choice: choice
  });

  if (error) {
    return showMessage("Spiel konnte nicht gestartet werden: " + error.message);
  }

  await loadAccount();

  showMessage(
    "Spiel abgeschlossen!\n" +
    "Ergebnis: " + data.result +
    "\nÄnderung: " + money(data.change) +
    "\nNeues Guthaben: " + money(data.balance)
  );
}

// COIN FLIP
async function coinFlip(stake, choice) {
  if (!["heads", "tails"].includes(choice)) {
    return showMessage("Bitte Kopf oder Zahl wählen!");
  }

  return playGame("coinflip", stake, choice);
}

// HORSE RACE
async function horseRace(stake, horse) {
  if (!["horse1", "horse2", "horse3", "horse4"].includes(horse)) {
    return showMessage("Ungültiges Pferd!");
  }

  return playGame("horserace", stake, horse);
}

// KRAKEN STOCKS
async function krakenStocks(stake, direction) {
  if (!["up", "down"].includes(direction)) {
    return showMessage("Bitte Up oder Down wählen!");
  }

  return playGame("stocks", stake, direction);
}
