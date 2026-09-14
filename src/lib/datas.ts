/**
 * A data do lead na lista de Leads: quando o e-mail do portal chegou
 * (capturado_em), nunca quando o sistema processou (created_at). A
 * diferença passa despercebida quase sempre (minutos), mas não depois do
 * resgate da Lixeira: ele grava leads de julho e agosto com created_at de
 * hoje. Sem esta conta, esses leads antigos apareceriam como se tivessem
 * chegado agora, que é exatamente o problema que o vendedor reclamou.
 *
 * As duas funções usam o fuso de São Paulo, como o resto do app (ver
 * api/_lib/ativacao.ts e api/numeros.ts): o servidor grava em UTC, e sem
 * fixar o fuso um lead capturado de madrugada em São Paulo cai no dia
 * errado.
 *
 * `agora` é sempre um parâmetro explícito, nunca lido de dentro da função
 * (mesma disciplina de dentroDaJanela em api/_lib/ativacao.ts): assim o
 * teste passa a data que quer, sem precisar congelar o relógio do sistema.
 */

/** "YYYY-MM-DD" no fuso de São Paulo. Mesma conta de diaSaoPaulo em
 * api/numeros.ts, duplicada aqui porque este arquivo vai para o bundle do
 * cliente e não pode importar código de servidor. */
function diaSaoPaulo(data: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(data);
}

function paraDataValida(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Diz se há data pra mostrar. A tela usa isto pra escolher entre o par
 * (relativa + absoluta) e o rótulo único "sem data": as duas funções abaixo
 * caem no mesmo texto quando não há data, e mostrar "sem data" duas vezes
 * na mesma célula seria redundante.
 */
export function temDataValida(iso: string | null | undefined): boolean {
  return paraDataValida(iso) !== null;
}

/**
 * A data curta, tipo "14/09": a lista roda dentro de um iframe e já tem
 * oito colunas, então o formato precisa ser enxuto. O ano só entra quando
 * diverge do ano de `agora`, para o caso raro (virada de ano) não ficar
 * ambíguo sem inflar a coluna no dia a dia, que fica sempre no mesmo ano.
 */
export function dataAbsolutaLead(iso: string | null | undefined, agora: Date): string {
  const data = paraDataValida(iso);
  if (!data) return "sem data";
  const mesmoAno = diaSaoPaulo(data).slice(0, 4) === diaSaoPaulo(agora).slice(0, 4);
  const opcoes: Intl.DateTimeFormatOptions = { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" };
  if (!mesmoAno) opcoes.year = "2-digit";
  return new Intl.DateTimeFormat("pt-BR", opcoes).format(data);
}

/**
 * "há 3 dias": o número que o vendedor usa para decidir o que atacar
 * primeiro, sem fazer conta de cabeça. A diferença é em dias de CALENDÁRIO
 * em São Paulo, não em horas corridas desde agora: um lead capturado ontem
 * à noite é "ontem" a tarde inteira de hoje, e não vira "há 22 horas" que
 * some para "há 1 dia" a cada minuto que passa.
 */
export function tempoDesdeLead(iso: string | null | undefined, agora: Date): string {
  const data = paraDataValida(iso);
  if (!data) return "sem data";

  const diaLead = Date.parse(`${diaSaoPaulo(data)}T00:00:00Z`);
  const diaAgora = Date.parse(`${diaSaoPaulo(agora)}T00:00:00Z`);
  const dias = Math.round((diaAgora - diaLead) / 86_400_000);

  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 30) {
    const semanas = Math.max(1, Math.round(dias / 7));
    return semanas === 1 ? "há 1 semana" : `há ${semanas} semanas`;
  }
  const meses = Math.max(1, Math.round(dias / 30));
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}
