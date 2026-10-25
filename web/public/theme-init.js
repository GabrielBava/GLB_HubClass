// Aplica o tema salvo (claro/escuro) antes da primeira pintura, evitando o "piscar".
(function () {
  try {
    var pref = localStorage.getItem("lc-theme");
    var dark = pref === "dark" || ((pref === "system" || !pref) && localStorage.getItem("lc-theme-default") === "dark") ||
      ((pref === "system" || (!pref && localStorage.getItem("lc-theme-default") === "system")) && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
