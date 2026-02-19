import { useState, useEffect, useRef, useCallback } from 'react'

const SPOTIFY_BASE = 'https://api.spotify.com/v1'

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-top-read',
  'user-read-recently-played',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ')

function ms2time(ms) {
  if (!ms) return '0:00'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function SpotifyIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  )
}

export default function App() {
  const [token, setToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [clientId, setClientId] = useState('')
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [activeTab, setActiveTab] = useState('player')
  const [playback, setPlayback] = useState(null)
  const [topTracks, setTopTracks] = useState([])
  const [topArtists, setTopArtists] = useState([])
  const [recentTracks, setRecentTracks] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [playlistQueue, setPlaylistQueue] = useState([])
  const [playlistName, setPlaylistName] = useState('My Playlist')
  const [loading, setLoadState] = useState({})
  const [timeRange, setTimeRange] = useState('medium_term')
  const [success, setSuccess] = useState('')
  const pollRef = useRef(null)

  const setL = (key, val) => setLoadState(p => ({ ...p, [key]: val }))

  // Leggi token dall'URL hash dopo OAuth redirect
  useEffect(() => {
    const hash = window.location.hash
    if (hash) {
      const params = new URLSearchParams(hash.replace('#', '?'))
      const tok = params.get('access_token')
      if (tok) {
        window.history.replaceState(null, '', window.location.pathname)
        initUser(tok)
      }
    }
    const saved = localStorage.getItem('spotify_client_id')
    if (saved) setClientId(saved)
  }, [])

  const startOAuth = () => {
    if (!clientId.trim()) { setError('Inserisci prima il Client ID!'); return }
    localStorage.setItem('spotify_client_id', clientId.trim())
    const redirectUri = window.location.origin + window.location.pathname
    const url = `https://accounts.spotify.com/authorize?client_id=${clientId.trim()}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}`
    window.location.href = url
  }

  const api = useCallback(async (path, method = 'GET', body = null) => {
    const res = await fetch(`${SPOTIFY_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (res.status === 401) { setToken(''); setUser(null); throw new Error('Token expired') }
    if (res.status === 204 || res.status === 202) return null
    if (!res.ok) throw new Error(`API error ${res.status}`)
    return res.json()
  }, [token])

  const initUser = useCallback(async (tok) => {
    try {
      const res = await fetch(`${SPOTIFY_BASE}/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      if (!res.ok) { setError('Token non valido o scaduto.'); return }
      const data = await res.json()
      setUser(data)
      setToken(tok)
      setError('')
    } catch {
      setError('Errore di connessione.')
    }
  }, [])

  // Poll playback
  useEffect(() => {
    if (!token) return
    const poll = async () => {
      try { const d = await api('/me/player'); setPlayback(d) } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 5000)
    return () => clearInterval(pollRef.current)
  }, [token, api])

  // Top tracks/artists
  useEffect(() => {
    if (!token || activeTab !== 'top') return
    const load = async () => {
      setL('top', true)
      try {
        const [tracks, artists] = await Promise.all([
          api(`/me/top/tracks?limit=20&time_range=${timeRange}`),
          api(`/me/top/artists?limit=15&time_range=${timeRange}`),
        ])
        setTopTracks(tracks?.items || [])
        setTopArtists(artists?.items || [])
      } catch {}
      setL('top', false)
    }
    load()
  }, [token, activeTab, timeRange, api])

  // Recent tracks
  useEffect(() => {
    if (!token || activeTab !== 'history') return
    const load = async () => {
      setL('history', true)
      try {
        const data = await api('/me/player/recently-played?limit=50')
        setRecentTracks(data?.items || [])
      } catch {}
      setL('history', false)
    }
    load()
  }, [token, activeTab, api])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setL('search', true)
    try {
      const data = await api(`/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=20`)
      setSearchResults(data?.tracks?.items || [])
    } catch {}
    setL('search', false)
  }

  const playControl = async (action) => {
    try {
      if (action === 'play') await api('/me/player/play', 'PUT')
      if (action === 'pause') await api('/me/player/pause', 'PUT')
      if (action === 'next') await api('/me/player/next', 'POST')
      if (action === 'prev') await api('/me/player/previous', 'POST')
      setTimeout(async () => { try { const d = await api('/me/player'); setPlayback(d) } catch {} }, 600)
    } catch {}
  }

  const playTrack = async (uri) => {
    try {
      await api('/me/player/play', 'PUT', { uris: [uri] })
      setTimeout(async () => { try { const d = await api('/me/player'); setPlayback(d) } catch {} }, 600)
    } catch {}
  }

  const createPlaylist = async () => {
    if (!playlistQueue.length || !playlistName.trim()) return
    setL('playlist', true)
    try {
      const pl = await api(`/users/${user.id}/playlists`, 'POST', {
        name: playlistName, description: 'Creata con Spotify WebApp', public: false,
      })
      await api(`/playlists/${pl.id}/tracks`, 'POST', { uris: playlistQueue.map(t => t.uri) })
      setSuccess(`Playlist "${playlistName}" creata con ${playlistQueue.length} brani!`)
      setPlaylistQueue([])
      setTimeout(() => setSuccess(''), 4000)
    } catch { setError('Errore nella creazione della playlist.') }
    setL('playlist', false)
  }

  const addToQueue = (track) => {
    if (!playlistQueue.find(t => t.id === track.id)) setPlaylistQueue(p => [...p, track])
  }

  const genreStats = (() => {
    const counts = {}
    topArtists.forEach(a => a.genres?.forEach(g => { counts[g] = (counts[g] || 0) + 1 }))
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  })()
  const maxGenre = genreStats[0]?.[1] || 1

  // ── LOGIN SCREEN ──
  if (!token) {
    const redirectUri = window.location.origin + window.location.pathname
    return (
      <div className="app">
        <div className="token-screen">
          <div className="token-logo"><SpotifyIcon /> Spotify WebApp</div>
          <div className="token-card">
            <h2>🚀 Accesso con Spotify</h2>
            {error && <div className="error-msg">{error}</div>}
            <div className="steps">
              <div className="step">
                <div className="step-num">1</div>
                <div>
                  Vai su{' '}
                  <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                    developer.spotify.com/dashboard
                  </a>{' '}
                  → <strong>Create app</strong>
                </div>
              </div>
              <div className="step">
                <div className="step-num">2</div>
                <div>
                  Nelle impostazioni aggiungi questo Redirect URI:<br />
                  <code>{redirectUri}</code>
                </div>
              </div>
              <div className="step">
                <div className="step-num">3</div>
                <div>Copia il <strong>Client ID</strong> e incollalo qui sotto</div>
              </div>
            </div>
            <div className="oauth-row">
              <input
                className="client-input"
                placeholder="Client ID (es. a1b2c3d4...)"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startOAuth()}
              />
              <button className="btn-primary" onClick={startOAuth}>Autorizza →</button>
            </div>
            <div className="divider">oppure inserisci manualmente</div>
            <div className="token-input-row">
              <input
                className="token-input"
                placeholder="Access token manuale (BQA...)"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && initUser(tokenInput.trim())}
              />
              <button className="btn-primary" onClick={() => initUser(tokenInput.trim())}>Entra</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── APP ──
  const isPlaying = playback?.is_playing
  const track = playback?.item
  const progress = track ? (playback.progress_ms / track.duration_ms) * 100 : 0

  const tabs = [
    { id: 'player', label: '▶ Now Playing' },
    { id: 'top', label: '🏆 Top Charts' },
    { id: 'search', label: '🔍 Cerca & Playlist' },
    { id: 'history', label: '📋 Cronologia' },
  ]

  return (
    <div className="app">
      {/* HEADER */}
      <div className="header">
        <div className="header-logo"><SpotifyIcon /> Spotify WebApp</div>
        <div className="user-pill">
          <div className="user-avatar">
            {user?.images?.[0]?.url
              ? <img src={user.images[0].url} alt="" />
              : user?.display_name?.[0]?.toUpperCase()}
          </div>
          <span>{user?.display_name}</span>
        </div>
      </div>

      {/* NAV */}
      <div className="nav">
        {tabs.map(t => (
          <button key={t.id} className={`nav-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="main">

        {/* ── NOW PLAYING ── */}
        {activeTab === 'player' && (
          <>
            <div className="section-title">Now Playing</div>
            {track ? (
              <div className="player-card">
                <div className="player-art">
                  {track.album?.images?.[0]?.url
                    ? <img src={track.album.images[0].url} alt="" />
                    : <div className="player-art-placeholder">🎵</div>}
                </div>
                <div className="player-info">
                  {isPlaying && <div className="playing-badge"><div className="dot" /> IN RIPRODUZIONE</div>}
                  <div className="player-track">{track.name}</div>
                  <div className="player-artist">
                    {track.artists?.map(a => a.name).join(', ')} · {track.album?.name}
                  </div>
                  <div className="player-controls">
                    <button className="ctrl-btn" onClick={() => playControl('prev')}>⏮</button>
                    <button className="ctrl-btn play" onClick={() => playControl(isPlaying ? 'pause' : 'play')}>
                      {isPlaying ? '⏸' : '▶'}
                    </button>
                    <button className="ctrl-btn" onClick={() => playControl('next')}>⏭</button>
                    <button className="add-btn" style={{ marginLeft: 8 }} onClick={() => addToQueue(track)}>+ Playlist</button>
                  </div>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                  <div className="player-time">
                    <span>{ms2time(playback.progress_ms)}</span>
                    <span>{ms2time(track.duration_ms)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">Nessuna riproduzione attiva.<br />Avvia Spotify su un dispositivo e riprova.</div>
            )}
            {playback?.device && (
              <div className="stat-card">
                <div style={{ fontSize: 13, fontFamily: "'DM Mono', monospace", color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  🔊 <strong style={{ color: 'var(--text)' }}>{playback.device.name}</strong>
                  &nbsp;· {playback.device.type} · {playback.device.volume_percent}% volume
                </div>
              </div>
            )}
          </>
        )}

        {/* ── TOP CHARTS ── */}
        {activeTab === 'top' && (
          <>
            <div className="section-header">
              <div className="section-title" style={{ margin: 0 }}>Top Charts</div>
              <select className="time-select" value={timeRange} onChange={e => setTimeRange(e.target.value)}>
                <option value="short_term">Ultime 4 settimane</option>
                <option value="medium_term">Ultimi 6 mesi</option>
                <option value="long_term">Sempre</option>
              </select>
            </div>
            {loading.top ? (
              <div className="loading"><div className="spinner" /> Caricamento...</div>
            ) : (
              <div className="grid-2" style={{ gap: 28, marginTop: 20 }}>
                <div>
                  <div className="section-title" style={{ fontSize: 16 }}>🎤 Artisti</div>
                  <div className="grid-5">
                    {topArtists.map(a => (
                      <div className="artist-card" key={a.id}>
                        <div className="artist-img">
                          {a.images?.[0]?.url
                            ? <img src={a.images[0].url} alt="" />
                            : <div className="artist-img-placeholder">🎤</div>}
                        </div>
                        <div className="artist-name">{a.name}</div>
                        {a.genres?.[0] && <div className="artist-genre">{a.genres[0]}</div>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="section-title" style={{ fontSize: 16 }}>🎵 Brani</div>
                  <div className="track-list">
                    {topTracks.map((t, i) => (
                      <div key={t.id} className={`track-row${track?.id === t.id ? ' active-track' : ''}`} onClick={() => playTrack(t.uri)}>
                        <div className="track-num">{i + 1}</div>
                        <div className="track-art">{t.album?.images?.[2]?.url && <img src={t.album.images[2].url} alt="" />}</div>
                        <div className="track-info">
                          <div className="track-name">{t.name}</div>
                          <div className="track-artist-name">{t.artists?.map(a => a.name).join(', ')}</div>
                        </div>
                        <button className="add-btn" onClick={e => { e.stopPropagation(); addToQueue(t) }}>+</button>
                        <div className="track-duration">{ms2time(t.duration_ms)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── SEARCH & PLAYLIST ── */}
        {activeTab === 'search' && (
          <>
            <div className="section-title">🔍 Cerca Brani</div>
            <div className="search-box">
              <input
                className="search-input"
                placeholder="Cerca un brano, artista, album..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button className="btn-primary" onClick={handleSearch}>Cerca</button>
            </div>
            {loading.search && <div className="loading"><div className="spinner" /> Ricerca...</div>}
            {searchResults.length > 0 && (
              <div className="track-list">
                {searchResults.map(t => (
                  <div key={t.id} className={`track-row${track?.id === t.id ? ' active-track' : ''}`} onClick={() => playTrack(t.uri)}>
                    <div className="track-art">{t.album?.images?.[2]?.url && <img src={t.album.images[2].url} alt="" />}</div>
                    <div className="track-info">
                      <div className="track-name">{t.name}</div>
                      <div className="track-artist-name">{t.artists?.map(a => a.name).join(', ')} · {t.album?.name}</div>
                    </div>
                    {t.explicit && <span className="tag">explicit</span>}
                    <button className="add-btn" onClick={e => { e.stopPropagation(); addToQueue(t) }}>+ Playlist</button>
                    <div className="track-duration">{ms2time(t.duration_ms)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="playlist-panel">
              <h3>📝 Crea Playlist {playlistQueue.length > 0 && <span className="tag">{playlistQueue.length} brani</span>}</h3>
              {success && <div className="success-msg">{success}</div>}
              {playlistQueue.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 13, fontFamily: "'DM Mono',monospace", marginBottom: 16 }}>
                  Aggiungi brani con il tasto <strong>+ Playlist</strong>
                </p>
              ) : (
                <div className="playlist-items">
                  {playlistQueue.map((t, i) => (
                    <div className="playlist-item" key={t.id}>
                      <span style={{ color: 'var(--muted)', fontFamily: "'DM Mono',monospace", fontSize: 12, width: 18 }}>{i + 1}</span>
                      <span className="playlist-item-name">{t.name} – {t.artists?.[0]?.name}</span>
                      <button className="playlist-item-remove" onClick={() => setPlaylistQueue(p => p.filter(x => x.id !== t.id))}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="playlist-form">
                <input
                  className="playlist-name-input"
                  placeholder="Nome della playlist..."
                  value={playlistName}
                  onChange={e => setPlaylistName(e.target.value)}
                />
                <button className="btn-primary" onClick={createPlaylist} disabled={!playlistQueue.length || loading.playlist}>
                  {loading.playlist ? 'Creazione...' : 'Crea su Spotify ✓'}
                </button>
                {playlistQueue.length > 0 && (
                  <button className="btn-ghost" onClick={() => setPlaylistQueue([])}>Svuota</button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── HISTORY & STATS ── */}
        {activeTab === 'history' && (
          <>
            <div className="section-title">📋 Cronologia & Stats</div>
            {topArtists.length > 0 && (
              <div className="grid-3" style={{ marginBottom: 28 }}>
                <div className="stat-card"><div className="stat-val">{topArtists.length}</div><div className="stat-label">artisti nel tuo top</div></div>
                <div className="stat-card"><div className="stat-val">{topTracks.length}</div><div className="stat-label">brani nel tuo top</div></div>
                <div className="stat-card"><div className="stat-val">{recentTracks.length}</div><div className="stat-label">brani recenti tracciati</div></div>
              </div>
            )}
            {genreStats.length > 0 && (
              <div className="stat-card" style={{ marginBottom: 28 }}>
                <div className="section-title" style={{ fontSize: 16, marginBottom: 16 }}>🎸 Top Generi</div>
                <div className="genre-bar-row">
                  {genreStats.map(([g, c]) => (
                    <div className="genre-bar-item" key={g}>
                      <div className="genre-bar-label"><span>{g}</span><span>{c}</span></div>
                      <div className="genre-bar"><div className="genre-bar-fill" style={{ width: `${(c / maxGenre) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="section-title" style={{ fontSize: 16 }}>⏱ Ascoltato di Recente</div>
            {loading.history ? (
              <div className="loading"><div className="spinner" /> Caricamento...</div>
            ) : recentTracks.length === 0 ? (
              <div className="empty-state">Nessun brano recente trovato.</div>
            ) : (
              <div className="track-list">
                {recentTracks.map((item, i) => {
                  const t = item.track
                  const playedAt = new Date(item.played_at).toLocaleString('it-IT', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })
                  return (
                    <div key={`${t.id}-${i}`} className="track-row" onClick={() => playTrack(t.uri)}>
                      <div className="track-art">{t.album?.images?.[2]?.url && <img src={t.album.images[2].url} alt="" />}</div>
                      <div className="track-info">
                        <div className="track-name">{t.name}</div>
                        <div className="track-artist-name">{t.artists?.map(a => a.name).join(', ')}</div>
                      </div>
                      <div className="track-duration">{playedAt}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
