/**
 * Tokens extraídos da interface do AIOS, onde este painel roda embedado.
 * Nada aqui é identidade própria: é a paleta da plataforma hospedeira, para
 * o embed não denunciar que veio de fora.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        aios: {
          /* Ação primária e item ativo (pílula preenchida). */
          acao: "#4F46E5",
          "acao-escura": "#4338CA",
          /* Selo suave, o padrão dos selos "Geral" deles. */
          selo: "#E0E7FF",
          "selo-texto": "#4338CA",
          /* Contagem e alerta numérico. */
          alerta: "#EF4444",
          /* Faixa informativa sólida. */
          info: "#1D4ED8",
          /* Faixa de atenção. */
          "atencao-fundo": "#FEF3E2",
          "atencao-texto": "#B45309",
          /* Superfícies, divisórias e texto. */
          fundo: "#F3F4F6",
          superficie: "#FFFFFF",
          borda: "#E5E7EB",
          texto: "#111827",
          "texto-suave": "#6B7280",
          /* Detalhe característico do AIOS: a linha de prévia dentro de um
           * item de lista é violeta, não cinza. */
          previa: "#6366F1",
          /* Erro e sucesso não estão no kit deles; derivados da mesma escala
           * para manter contraste de leitura (>= 4.5:1 sobre o fundo claro). */
          "erro-fundo": "#FEF2F2",
          "erro-texto": "#B91C1C",
          "ok-fundo": "#ECFDF5",
          "ok-texto": "#047857",
        },
      },
      fontFamily: {
        /* Uma família só: sans humanista levemente arredondada. */
        sans: ["Figtree", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      borderRadius: {
        /* Cantos moderados; pílula fica por conta de rounded-full. */
        aios: "10px",
      },
      boxShadow: {
        /* Eles separam por borda e por fundo, não por sombra. */
        aios: "0 1px 2px 0 rgb(17 24 39 / 0.04)",
      },
    },
  },
  plugins: [],
};
