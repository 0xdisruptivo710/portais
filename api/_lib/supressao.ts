export interface ArgsSupressao {
  ultimoContatoEm: Date | null;
  janelaDias: number;
  agora: Date;
  killSwitch: boolean;
}

/**
 * Lead que anuncia em três portais gera três e-mails. Sem esta guarda ele
 * recebe três "oi" da mesma loja no mesmo dia.
 */
export function decidirSupressao(a: ArgsSupressao): { suprimir: boolean; motivo: string | null } {
  if (a.killSwitch) return { suprimir: true, motivo: "kill-switch ligado" };
  if (!a.ultimoContatoEm) return { suprimir: false, motivo: null };

  const dias = (a.agora.getTime() - a.ultimoContatoEm.getTime()) / 86_400_000;
  if (dias <= a.janelaDias) {
    return { suprimir: true, motivo: `contatado ha ${Math.floor(dias)}d, janela de ${a.janelaDias}d` };
  }
  return { suprimir: false, motivo: null };
}
