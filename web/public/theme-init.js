// Aplica o tema salvo (claro/escuro) antes da primeira pintura, evitando o "piscar".
// Sem escolha da pessoa, vale o padrão da plataforma; sem padrão conhecido, segue o sistema (como o simulador).
(function () {
  try {
    var mode = localStorage.getItem("lc-theme") || localStorage.getItem("lc-theme-default") || "system";
    var dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
