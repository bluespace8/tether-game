/* Tether DOM screens. They call back into main.js; they never touch the state except to read it. */
var TetherUI = (function () {
  "use strict";
  var G = TetherGame;
  var LOCK_MS = 400;     // a stray tap from the last drag cannot pick a card
  var cb = {};
  var el = {};
  var selected = null, shownAt = 0;

  function $(id) { return document.getElementById(id); }

  function init(callbacks) {
    cb = callbacks;
    el.cards = $("screen-cards");
    el.cardsTitle = $("cards-title");
    el.cardsSub = $("cards-sub");
    el.cardsList = $("cards-list");
    el.cardsHint = $("cards-hint");
    el.take = $("cards-take");
    el.take.addEventListener("click", function () {
      if (selected && performance.now() - shownAt >= LOCK_MS) cb.onPick(selected);
    });
  }

  function rarityLabel(r) { return r === "filler" ? "REPAIR" : r.toUpperCase(); }

  function showCards(state) {
    selected = null;
    shownAt = performance.now();
    el.cardsTitle.textContent = "SECTOR " + state.sector + " CLEARED";
    el.cardsSub.textContent = "+" + (G.TUNING.score.sector * state.sector) + " points    Hull " + Math.round(state.station.hp) + "/" + state.station.hpMax;
    el.cardsList.textContent = "";
    state.offer.forEach(function (id) {
      var card = null;
      for (var i = 0; i < G.CARDS.length; i++) if (G.CARDS[i].id === id) card = G.CARDS[i];
      var owned = state.cards[id] || 0;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "card " + card.rarity + " locked";
      b.dataset.id = id;
      var row = document.createElement("div"); row.className = "row";
      var rar = document.createElement("span"); rar.className = "rar"; rar.textContent = rarityLabel(card.rarity);
      var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = card.name;
      row.appendChild(rar); row.appendChild(nm);
      var tx = document.createElement("div"); tx.className = "tx"; tx.textContent = G.cardText(id, owned + 1);
      b.appendChild(row); b.appendChild(tx);
      if (owned > 0) {
        var ow = document.createElement("div"); ow.className = "own"; ow.textContent = "(owned " + owned + ")";
        b.appendChild(ow);
      }
      b.addEventListener("click", function () { onCardTap(id); });
      el.cardsList.appendChild(b);
    });
    el.take.disabled = true;
    el.cardsHint.textContent = "Tap a card to select it";
    el.cards.hidden = false;
    setTimeout(function () {
      var bs = el.cardsList.children;
      for (var i = 0; i < bs.length; i++) bs[i].classList.remove("locked");
    }, LOCK_MS);
  }

  function onCardTap(id) {
    if (performance.now() - shownAt < LOCK_MS) return;
    if (selected === id) { cb.onPick(id); return; }       // second tap confirms
    selected = id;
    var bs = el.cardsList.children;
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].dataset.id === id);
    el.take.disabled = false;
    el.cardsHint.textContent = "Tap again or press Take";
  }

  function hideCards() { el.cards.hidden = true; selected = null; }

  return { init: init, showCards: showCards, hideCards: hideCards };
})();
