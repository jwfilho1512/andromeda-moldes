import {
  IconApps,
  IconBox,
  IconBrandGithub,
  IconBrush,
  IconBug,
  IconDownload,
  IconExternalLink,
  IconFolder,
  IconFolderOpen,
  IconHanger,
  IconHelp,
  IconPlus,
  IconRefresh,
  IconScissors,
} from '@tabler/icons-react';
import { type ComponentType, useCallback, useEffect, useState } from 'react';
import { compareVersions, RELEASES_URL, REPO } from '../electron/catalog';
import { type AppId, type AppStatus, type Product, type Progress, type ReleaseInfo, hub, isDesktop } from './api';

type Page = 'apps' | 'produtos' | 'ajuda';

const ICON: Record<AppId, ComponentType<{ size?: number }>> = { draw: IconBrush, moldes: IconScissors, '3d': IconBox };
const STATUS: Record<string, string> = { rascunho: 'Rascunho', desenvolvimento: 'Em desenvolvimento', aprovada: 'Aprovada', producao: 'Em produção' };

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#141a33" />
      <path d="M18 66L36 56L54 50L80 34M54 50L64 74M36 56L42 30" fill="none" stroke="#8d9bff" strokeWidth="3" strokeLinecap="round" />
      {[[18, 66, 4], [36, 56, 4.5], [80, 34, 4], [64, 74, 3.6], [42, 30, 3.4]].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#e9ecff" />
      ))}
      <path fill="#ffd27a" transform="translate(54 50) scale(11)" d="M0,-1L0.22,-0.22L1,0L0.22,0.22L0,1L-0.22,0.22L-1,0L-0.22,-0.22Z" />
    </svg>
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function App() {
  const [page, setPage] = useState<Page>('apps');
  const [apps, setApps] = useState<AppStatus[]>([]);
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress | 'erro' | undefined>>({});
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);
  const [info, setInfo] = useState<{ version: string } | null>(null);

  const say = (text: string, err = false) => {
    setToast({ text, err });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 5000);
  };

  const refreshApps = useCallback(async () => setApps(await hub.apps()), []);
  const refreshRelease = useCallback(async (force = false) => setRel(await hub.release(force)), []);

  useEffect(() => {
    void refreshApps();
    void refreshRelease();
    void hub.info().then(setInfo);
    return hub.onInstallProgress((p) => setProgress((s) => ({ ...s, [p.id]: p })));
  }, [refreshApps, refreshRelease]);

  const install = async (a: AppStatus) => {
    setProgress((s) => ({ ...s, [a.id]: { id: a.id, phase: 'baixando', f: 0 } }));
    const r = await hub.install(a.id);
    setProgress((s) => ({ ...s, [a.id]: undefined }));
    if (r.ok) say(`${a.name} instalado`);
    else say(r.error ?? 'Não foi possível instalar', true);
    await refreshApps();
  };

  const open = async (id: AppId, file?: string) => {
    const err = await hub.openApp(id, file);
    if (err) say(err, !err.startsWith('Simulação'));
  };

  return (
    <div className="hub">
      <aside className="side">
        <div className="brand">
          <Mark />
          <div>
            <b>Andromeda</b>
            <small>Fashion Studio</small>
          </div>
        </div>
        <nav>
          <button className={page === 'apps' ? 'on' : ''} onClick={() => setPage('apps')}>
            <IconApps size={17} /> Apps
          </button>
          <button className={page === 'produtos' ? 'on' : ''} onClick={() => setPage('produtos')}>
            <IconHanger size={17} /> Produtos
          </button>
          <button className={page === 'ajuda' ? 'on' : ''} onClick={() => setPage('ajuda')}>
            <IconHelp size={17} /> Ajuda
          </button>
        </nav>
        <div className="foot">
          Hub {info?.version ?? ''}
          {!isDesktop && <span className="tag">simulação</span>}
        </div>
      </aside>

      <main className="main">
        {page === 'apps' && <AppsPage apps={apps} rel={rel} progress={progress} onInstall={install} onOpen={(id) => void open(id)} onCheck={() => void refreshRelease(true).then(refreshApps)} />}
        {page === 'produtos' && <ProductsPage apps={apps} onOpen={open} say={say} />}
        {page === 'ajuda' && <HelpPage />}
      </main>

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.text}</div>}
    </div>
  );
}

function AppsPage({
  apps,
  rel,
  progress,
  onInstall,
  onOpen,
  onCheck,
}: {
  apps: AppStatus[];
  rel: ReleaseInfo | null;
  progress: Record<string, Progress | 'erro' | undefined>;
  onInstall: (a: AppStatus) => void;
  onOpen: (id: AppId) => void;
  onCheck: () => void;
}) {
  return (
    <>
      <header className="ph">
        <div>
          <h1>Seus apps</h1>
          <p className="muted">
            {rel === null ? 'Procurando a versão mais nova…' : rel.ok ? `Versão mais nova publicada: ${rel.version}` : `Sem conexão com as atualizações: ${rel.error}`}
          </p>
        </div>
        <button className="ghost" onClick={onCheck}>
          <IconRefresh size={16} /> Procurar atualizações
        </button>
      </header>
      <div className="cards">
        {apps.map((a) => {
          const Icon = ICON[a.id];
          const asset = rel?.assets?.[a.id] ?? null;
          const p = progress[a.id];
          const update = a.installed && !!asset && !!rel?.version && !!a.version && compareVersions(rel.version, a.version) > 0;
          return (
            <article key={a.id} className={`app ${a.soon ? 'soon' : ''} ${a.installed ? 'inst' : ''}`}>
              <div className={`app-icon ${a.id}`}>
                <Icon size={26} />
              </div>
              <h2>{a.name}</h2>
              <p className="muted">{a.desc}</p>
              <div className="state">
                {a.soon ? (
                  <span className="pill">Em breve</span>
                ) : a.installed ? (
                  <span className="pill ok">Instalado{a.version ? ` · ${a.version}` : ''}</span>
                ) : (
                  <span className="pill">Não instalado</span>
                )}
                {update && <span className="pill warn">Nova versão {rel?.version}</span>}
              </div>
              {p && p !== 'erro' ? (
                <div className="prog">
                  <div className="bar">
                    <span style={{ width: `${Math.round(p.f * 100)}%` }} className={p.phase === 'instalando' ? 'pulse' : ''} />
                  </div>
                  <small>{p.phase === 'baixando' ? `Baixando… ${Math.round(p.f * 100)}%` : 'Instalando…'}</small>
                </div>
              ) : (
                <div className="btns">
                  {a.soon ? (
                    <button disabled>Em desenvolvimento</button>
                  ) : a.installed ? (
                    <>
                      <button className="primary" onClick={() => onOpen(a.id)}>
                        Abrir
                      </button>
                      {update && (
                        <button onClick={() => onInstall(a)}>
                          <IconDownload size={15} /> Atualizar
                        </button>
                      )}
                    </>
                  ) : asset ? (
                    <button className="primary" onClick={() => onInstall(a)}>
                      <IconDownload size={15} /> Instalar · {Math.round(asset.size / 1e6)} MB
                    </button>
                  ) : (
                    <button disabled title="O instalador deste app ainda não foi publicado para este computador">
                      Chega na próxima versão
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="muted small">
        Os apps são baixados das <a onClick={() => void hub.openExternal(RELEASES_URL)}>Releases do projeto no GitHub</a>, direto para a pasta de Aplicativos (Mac) ou de programas do seu usuário (Windows).
      </p>
    </>
  );
}

function ProductsPage({ apps, onOpen, say }: { apps: AppStatus[]; onOpen: (id: AppId, file?: string) => Promise<void>; say: (t: string, e?: boolean) => void }) {
  const [data, setData] = useState<{ workspace: string; exists: boolean; products: Product[] } | null>(null);
  const [form, setForm] = useState<{ ref: string; nome: string; colecao: string; moldes: boolean } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => setData(await hub.products()), []);
  useEffect(() => {
    void load();
  }, [load]);
  const has = (id: AppId) => apps.find((a) => a.id === id)?.installed;

  const create = async () => {
    if (!form) return;
    if (!form.ref.trim() && !form.nome.trim()) {
      setErr('Escreva a referência ou o nome');
      return;
    }
    const r = await hub.createProduct({ ...form, ref: form.ref.trim(), nome: form.nome.trim(), colecao: form.colecao.trim() });
    if (!r.ok) {
      setErr(r.error ?? 'Não foi possível criar');
      return;
    }
    setForm(null);
    say(`Referência ${form.ref || form.nome} criada`);
    await load();
    if (r.adraw && has('draw')) await onOpen('draw', r.adraw);
  };

  return (
    <>
      <header className="ph">
        <div>
          <h1>Produtos</h1>
          <p className="muted">
            <IconFolder size={14} /> {data?.workspace ?? '…'}
          </p>
        </div>
        <div className="row">
          <button
            className="ghost"
            onClick={async () => {
              if (await hub.pickWorkspace()) void load();
            }}
          >
            <IconFolderOpen size={16} /> Trocar pasta
          </button>
          <button className="ghost" onClick={() => void load()}>
            <IconRefresh size={16} />
          </button>
          <button className="primary" onClick={() => (setForm({ ref: '', nome: '', colecao: '', moldes: true }), setErr(''))}>
            <IconPlus size={16} /> Nova referência
          </button>
        </div>
      </header>

      {form && (
        <div className="form">
          <label>
            Referência
            <input autoFocus value={form.ref} placeholder="0201" onChange={(e) => (setForm({ ...form, ref: e.target.value }), setErr(''))} />
          </label>
          <label className="grow">
            Produto
            <input value={form.nome} placeholder="Moletom canguru" onChange={(e) => (setForm({ ...form, nome: e.target.value }), setErr(''))} />
          </label>
          <label>
            Coleção
            <input value={form.colecao} placeholder="Inverno 27" onChange={(e) => setForm({ ...form, colecao: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.moldes} onChange={(e) => setForm({ ...form, moldes: e.target.checked })} /> Criar arquivo de moldes
          </label>
          <button className="primary" onClick={() => void create()}>
            Criar
          </button>
          <button className="ghost" onClick={() => setForm(null)}>
            Cancelar
          </button>
          {err && <span className="err">{err}</span>}
        </div>
      )}

      {data && !data.exists && <p className="muted">A pasta ainda não existe. Crie a primeira referência e ela é criada.</p>}
      {data && data.exists && !data.products.length && <p className="muted">Nenhum desenho (.adraw) ou molde (.ctx) nesta pasta ainda.</p>}
      {data && data.products.length > 0 && (
        <table className="prods">
          <thead>
            <tr>
              <th>Referência</th>
              <th>Coleção</th>
              <th>Status</th>
              <th>Desenho e ficha</th>
              <th>Moldes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.key}>
                <td>
                  <b>{p.ref}</b>
                  {p.nome !== p.ref && <span className="muted"> · {p.nome}</span>}
                </td>
                <td className="muted">{p.colecao || '—'}</td>
                <td>{p.status ? <span className={`st st-${p.status}`}>{STATUS[p.status] ?? p.status}</span> : <span className="muted">—</span>}</td>
                <td>
                  {p.desenho ? (
                    <button className="link" onClick={() => void onOpen('draw', p.desenho!)} disabled={!has('draw')} title={has('draw') ? 'Abrir no Andromeda Draw' : 'Instale o Draw na aba Apps'}>
                      <IconBrush size={14} /> Abrir
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {p.moldes.length ? (
                    p.moldes.map((m) => (
                      <button key={m} className="link" onClick={() => void onOpen('moldes', m)} disabled={!has('moldes')} title={has('moldes') ? m : 'Instale o Moldes na aba Apps'}>
                        <IconScissors size={14} /> Abrir
                      </button>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <button className="link" title="Mostrar a pasta" onClick={() => void hub.reveal(p.desenho ?? p.moldes[0] ?? p.dir)}>
                    <IconFolder size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function HelpPage() {
  const link = (url: string) => void hub.openExternal(url);
  return (
    <>
      <header className="ph">
        <div>
          <h1>Ajuda</h1>
          <p className="muted">Como os apps trabalham juntos</p>
        </div>
      </header>
      <ol className="steps">
        <li>
          <b>Instale</b> o Draw e o Moldes na aba Apps. O hub avisa quando sair versão nova.
        </li>
        <li>
          <b>Crie uma referência</b> em Produtos: o hub cria a pasta do produto com o desenho (.adraw) e os moldes (.ctx), já vinculados.
        </li>
        <li>
          <b>No Draw</b>, desenhe o técnico e preencha a ficha. O botão "Abrir no Andromeda Moldes" da ficha leva aos moldes daquela referência.
        </li>
        <li>
          <b>No Moldes</b>, modele, gradue e faça o risco. O consumo de tecido vai para a ficha.
        </li>
      </ol>
      <div className="row">
        <button className="ghost" onClick={() => link(RELEASES_URL)}>
          <IconExternalLink size={16} /> Versões e instaladores
        </button>
        <button className="ghost" onClick={() => link(`https://github.com/${REPO}`)}>
          <IconBrandGithub size={16} /> Código aberto (MIT)
        </button>
        <button className="ghost" onClick={() => link(`https://github.com/${REPO}/issues`)}>
          <IconBug size={16} /> Relatar um problema
        </button>
      </div>
    </>
  );
}
