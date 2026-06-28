/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import {
  createChannel,
  createGuild,
  createMessage,
  getMe,
  listChannels,
  listGuilds,
  listMessages,
  login,
  register,
} from "./api";
import type { Channel, Guild, Message, User } from "./api";
import { useVoiceRoom } from "./voice/useVoiceRoom";
import { VoicePanel } from "./voice/VoicePanel";

type AuthMode = "login" | "register";
type ChannelDraftType = "text" | "voice";

const TOKEN_KEY = "kimspeak_token";

function getInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "K";
}

function formatTime(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function App() {
  const voice = useVoiceRoom();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("k1epa");
  const [email, setEmail] = useState("k1epa@example.com");
  const [password, setPassword] = useState("123456");

  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState<User | null>(null);

  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const [activeGuildId, setActiveGuildId] = useState("");
  const [activeChannelId, setActiveChannelId] = useState("");

  const [guildName, setGuildName] = useState("Kimspeak HQ");
  const [channelName, setChannelName] = useState("general");
  const [channelType, setChannelType] = useState<ChannelDraftType>("text");
  const [messageDraft, setMessageDraft] = useState("");

  const [status, setStatus] = useState("Готов к работе");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(() => Boolean(token));
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const activeGuild = useMemo(
    () => guilds.find((guild) => guild.id === activeGuildId) || null,
    [activeGuildId, guilds],
  );

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) || null,
    [activeChannelId, channels],
  );

  const textChannels = useMemo(
    () => channels.filter((channel) => channel.type === "text"),
    [channels],
  );

  const voiceChannels = useMemo(
    () => channels.filter((channel) => channel.type === "voice"),
    [channels],
  );

  const isActiveVoiceChannelJoined =
    activeChannel?.type === "voice" && voice.currentChannelId === activeChannel.id;
  const isActiveVoiceConnecting = isActiveVoiceChannelJoined && voice.state === "connecting";

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);

    if (!savedToken) {
      setIsCheckingAuth(false);
      return;
    }

    setStatus("Проверяем авторизацию...");

    getMe(savedToken)
      .then((me) => {
        setToken(savedToken);
        setUser(me);
        setStatus("Авторизация подтверждена");
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setUser(null);
        setStatus("Сессия истекла, войдите заново");
      })
      .finally(() => {
        setIsCheckingAuth(false);
      });
  }, []);

  useEffect(() => {
    if (!token || !user) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    listGuilds(token)
      .then((items) => {
        setGuilds(items);
        setActiveGuildId((current) => current || items[0]?.id || "");
        setStatus(items.length ? "Серверы загружены" : "Создайте первый сервер");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Не удалось загрузить серверы");
        setStatus("Ошибка загрузки серверов");
      })
      .finally(() => {
        setIsWorkspaceLoading(false);
      });
  }, [token, user]);

  useEffect(() => {
    if (!token || !activeGuildId) {
      setChannels([]);
      setActiveChannelId("");
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    listChannels(token, activeGuildId)
      .then((items) => {
        setChannels(items);
        setActiveChannelId((current) => {
          if (items.some((channel) => channel.id === current)) {
            return current;
          }

          return items.find((channel) => channel.type === "text")?.id || items[0]?.id || "";
        });
        setStatus(items.length ? "Каналы загружены" : "Создайте первый канал");
      })
      .catch((err) => {
        setChannels([]);
        setActiveChannelId("");
        setError(err instanceof Error ? err.message : "Не удалось загрузить каналы");
        setStatus("Ошибка загрузки каналов");
      })
      .finally(() => {
        setIsWorkspaceLoading(false);
      });
  }, [activeGuildId, token]);

  useEffect(() => {
    if (!token || !activeChannelId || activeChannel?.type !== "text") {
      setMessages([]);
      return;
    }

    setIsMessagesLoading(true);
    setError("");

    listMessages(token, activeChannelId)
      .then((items) => {
        setMessages(items);
        setStatus("Сообщения загружены");
      })
      .catch((err) => {
        setMessages([]);
        setError(err instanceof Error ? err.message : "Не удалось загрузить сообщения");
        setStatus("Ошибка загрузки сообщений");
      })
      .finally(() => {
        setIsMessagesLoading(false);
      });
  }, [activeChannel, activeChannelId, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      if (mode === "register") {
        setStatus("Создаём аккаунт...");
        await register(username, email, password);
        setStatus("Аккаунт создан. Теперь можно войти");
        setMode("login");
        return;
      }

      setStatus("Выполняем вход...");

      const response = await login(email, password);
      const receivedToken = response.access_token || response.token;

      if (!receivedToken || !response.user) {
        throw new Error("Backend не вернул пользователя или access_token");
      }

      localStorage.setItem(TOKEN_KEY, receivedToken);
      setToken(receivedToken);
      setUser(response.user);
      setStatus("Вход выполнен успешно");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      setError(message);
      setStatus("Ошибка");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateGuild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !guildName.trim()) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      const guild = await createGuild(token, guildName.trim());
      setGuilds((items) => [...items, guild]);
      setActiveGuildId(guild.id);
      setGuildName("");
      setStatus("Сервер создан");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать сервер");
      setStatus("Ошибка создания сервера");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !activeGuildId || !channelName.trim()) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      const channel = await createChannel(
        token,
        activeGuildId,
        channelName.trim().replace(/^#/, ""),
        channelType,
      );
      setChannels((items) => [...items, channel]);
      setActiveChannelId(channel.id);
      setChannelName(channelType === "text" ? "general" : "lobby");
      setStatus("Канал создан");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать канал");
      setStatus("Ошибка создания канала");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }

  async function handleCreateVoiceChannel() {
    if (!token || !activeGuildId) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      const channel = await createChannel(token, activeGuildId, "voice", "voice");
      setChannels((items) => [...items, channel]);
      setActiveChannelId(channel.id);
      setStatus("Голосовой канал создан");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать голосовой канал");
      setStatus("Ошибка создания канала");
    } finally {
      setIsWorkspaceLoading(false);
    }
  }

  function handleJoinVoiceChannel(channel: Channel) {
    setActiveChannelId(channel.id);

    if (!user || voice.currentChannelId === channel.id) {
      return;
    }

    voice.joinVoice({
      channelId: channel.id,
      channelName: channel.name,
      userId: user.id,
      username: user.username,

    });
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !activeChannelId || !messageDraft.trim()) {
      return;
    }

    setIsSending(true);
    setError("");

    try {
      const message = await createMessage(token, activeChannelId, messageDraft.trim());
      setMessages((items) => [...items, message]);
      setMessageDraft("");
      setStatus("Сообщение отправлено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить сообщение");
      setStatus("Ошибка отправки");
    } finally {
      setIsSending(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setGuilds([]);
    setChannels([]);
    setMessages([]);
    setActiveGuildId("");
    setActiveChannelId("");
    setStatus("Вы вышли из аккаунта");
    setError("");
  }

  if (isCheckingAuth) {
    return (
      <div className="loadingPage">
        <div className="loadingCard">
          <div className="brandMark">K</div>
          <h1>kimspeak</h1>
          <p>Проверяем авторизацию...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="authPage">
        <section className="authHero">
          <div className="brandMark">K</div>
          <h1>kimspeak</h1>
          <p>
            Войдите в аккаунт, чтобы открыть серверы, каналы и живую ленту
            сообщений для вашей команды.
          </p>
        </section>

        <section className="authCard">
          <div className="authTitle">{mode === "login" ? "Вход" : "Регистрация"}</div>

          <div className="authTabs" role="tablist" aria-label="Режим авторизации">
            <button
              className={mode === "login" ? "authTab active" : "authTab"}
              onClick={() => setMode("login")}
              type="button"
            >
              Вход
            </button>
            <button
              className={mode === "register" ? "authTab active" : "authTab"}
              onClick={() => setMode("register")}
              type="button"
            >
              Регистрация
            </button>
          </div>

          <form className="authForm" onSubmit={handleSubmit}>
            {mode === "register" && (
              <label>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="k1epa"
                  autoComplete="username"
                />
              </label>
            )}

            <label>
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="k1epa@example.com"
                type="email"
                autoComplete="email"
              />
            </label>

            <label>
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="123456"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            <button className="submitButton" disabled={isLoading}>
              {isLoading ? "Отправляем..." : mode === "login" ? "Войти" : "Создать аккаунт"}
            </button>
          </form>

          <div className="statusBox">
            <div>
              <b>Статус:</b> {status}
            </div>
            {error && <div className="errorText">{error}</div>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="servers" aria-label="Серверы">
        <div className="serverLogo">K</div>

        <div className="serverRail">
          {guilds.map((guild) => (
            <button
              className={guild.id === activeGuildId ? "server active" : "server"}
              key={guild.id}
              onClick={() => setActiveGuildId(guild.id)}
              title={guild.name}
              type="button"
            >
              {getInitial(guild.name)}
            </button>
          ))}
        </div>
      </aside>

      <aside className="channels">
        <div className="guildTitle">
          <div>
            <span>{activeGuild?.name || "Нет сервера"}</span>
            <small>{isWorkspaceLoading ? "Синхронизация..." : status}</small>
          </div>
        </div>

        <form className="quickCreate" onSubmit={handleCreateGuild}>
          <input
            value={guildName}
            onChange={(event) => setGuildName(event.target.value)}
            placeholder="Новый сервер"
          />
          <button disabled={isWorkspaceLoading || !guildName.trim()} title="Создать сервер">
            +
          </button>
        </form>

        <div className="channelScroll">
          <div className="channelBlock">
            <div className="channelCategory">Текстовые каналы</div>
            {textChannels.map((channel) => (
              <button
                className={channel.id === activeChannelId ? "channel active" : "channel"}
                key={channel.id}
                onClick={() => setActiveChannelId(channel.id)}
                type="button"
              >
                <span>#</span>
                {channel.name}
              </button>
            ))}
            {!textChannels.length && <div className="emptyHint">Пока нет текстовых каналов</div>}
          </div>

          <div className="channelBlock">
            <div className="channelCategory">Голосовые каналы</div>
            {voiceChannels.map((channel) => (
              <div className="voiceChannelRow" key={channel.id}>
                <button
                  className={
                    channel.id === activeChannelId || channel.id === voice.currentChannelId
                      ? "channel active"
                      : "channel"
                  }
                  onClick={() => setActiveChannelId(channel.id)}
                  type="button"
                >
                  <span>♪</span>
                  {channel.name}
                </button>
                <button
                  className="channelJoinButton"
                  disabled={voice.currentChannelId === channel.id && voice.state !== "error"}
                  onClick={() => handleJoinVoiceChannel(channel)}
                  type="button"
                >
                  {voice.currentChannelId === channel.id && voice.state !== "error"
                    ? "Внутри"
                    : "Войти"}
                </button>
              </div>
            ))}
            {!voiceChannels.length && (
              <div className="emptyHint emptyHintWithAction">
                <span>Пока нет голосовых каналов</span>
                <button
                  className="emptyActionButton"
                  disabled={isWorkspaceLoading || !activeGuild}
                  onClick={handleCreateVoiceChannel}
                  type="button"
                >
                  Создать голосовой
                </button>
              </div>
            )}
          </div>
        </div>

        {activeGuild && (
          <form className="channelCreate" onSubmit={handleCreateChannel}>
            <div className="channelTypeToggle">
              <button
                className={channelType === "text" ? "active" : ""}
                onClick={() => setChannelType("text")}
                type="button"
              >
                #
              </button>
              <button
                className={channelType === "voice" ? "active" : ""}
                onClick={() => setChannelType("voice")}
                type="button"
              >
                ♪
              </button>
            </div>
            <input
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              placeholder="Новый канал"
            />
            <button disabled={isWorkspaceLoading || !channelName.trim()} title="Создать канал">
              +
            </button>
          </form>
        )}

        <div className="profilePanel">
          <div className="profileAvatar">{getInitial(user.username)}</div>
          <div className="profileInfo">
            <div className="profileName">{user.username}</div>
            <div className="profileStatus online">online</div>
          </div>
          <button className="profileLogout" onClick={logout} title="Выйти" type="button">
            ⏻
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <strong>
              {activeChannel?.type === "voice" ? "♪" : "#"} {activeChannel?.name || "канал не выбран"}
            </strong>
            <span>
              {activeGuild
                ? `Сервер ${activeGuild.name}`
                : "Создайте сервер, чтобы начать общение"}
            </span>
          </div>
        </header>

        <section className="chat">
          {!activeGuild && (
            <div className="emptyState">
              <h2>Создайте первый сервер</h2>
              <p>После этого можно будет добавить каналы и начать переписку.</p>
            </div>
          )}

          {activeGuild && !activeChannel && (
            <div className="emptyState">
              <h2>Добавьте канал</h2>
              <p>Текстовый канал нужен для сообщений, голосовой можно оставить как комнату.</p>
            </div>
          )}

          {activeChannel?.type === "voice" && (
            <div className="voiceRoom">
              <div className="pulse">♪</div>
              <h2>{activeChannel.name}</h2>
              <p>Голосовая комната готова. Текстовые сообщения доступны в каналах с #.</p>
              <button
                className="voiceRoomJoinButton"
                disabled={isActiveVoiceChannelJoined && voice.state !== "error"}
                onClick={() => handleJoinVoiceChannel(activeChannel)}
                type="button"
              >
                {isActiveVoiceConnecting
                  ? "Подключаемся..."
                  : isActiveVoiceChannelJoined && voice.state !== "error"
                    ? "Вы в канале"
                    : "Войти в голос"}
              </button>
            </div>
          )}

          {activeChannel?.type === "text" && isMessagesLoading && (
            <div className="emptyHint">Загружаем сообщения...</div>
          )}

          {activeChannel?.type === "text" && !isMessagesLoading && !messages.length && (
            <div className="emptyState">
              <h2>Тут пока тихо</h2>
              <p>Напишите первое сообщение в #{activeChannel.name}.</p>
            </div>
          )}

          {activeChannel?.type === "text" &&
            messages.map((message) => {
              const isOwn = message.author_id === user.id;
              const authorName = isOwn ? user.username : `user-${message.author_id.slice(0, 6)}`;

              return (
                <article className={isOwn ? "message ownMessage" : "message"} key={message.id}>
                  <div className="avatar">{getInitial(authorName)}</div>
                  <div className="messageBody">
                    <div className="messageMeta">
                      <span className="author">{authorName}</span>
                      <time>{formatTime(message.created_at)}</time>
                    </div>
                    <p>{message.content}</p>
                  </div>
                </article>
              );
            })}
        </section>

        {error && <div className="inlineError">{error}</div>}

        <form className="messageInput" onSubmit={handleSendMessage}>
          <input
            disabled={!activeChannel || activeChannel.type !== "text" || isSending}
            value={messageDraft}
            onChange={(event) => setMessageDraft(event.target.value)}
            placeholder={
              activeChannel?.type === "text"
                ? `Написать сообщение в #${activeChannel.name}`
                : "Выберите текстовый канал"
            }
          />
          <button
            disabled={
              !activeChannel || activeChannel.type !== "text" || !messageDraft.trim() || isSending
            }
          >
            Отправить
          </button>
        </form>
      </main>

      <aside className="members">
        <div className="accountPanel">
          <div className="bigAvatar">{getInitial(user.username)}</div>
          <div className="accountName">{user.username}</div>
          <div className="accountEmail">{user.email}</div>
        </div>

        <div className="membersPanel">
          <div className="membersTitle">Участники</div>
          <div className="member">
            <div className="memberAvatar">{getInitial(user.username)}</div>
            <span>{user.username}</span>
          </div>
          <div className="member muted">
            <div className="memberAvatar">K</div>
            <span>kimspeak-bot</span>
          </div>
        </div>

        <div className="membersPanel">
          <div className="membersTitle">Сводка</div>
          <div className="statRow">
            <span>Серверы</span>
            <b>{guilds.length}</b>
          </div>
          <div className="statRow">
            <span>Каналы</span>
            <b>{channels.length}</b>
          </div>
          <div className="statRow">
            <span>Сообщения</span>
            <b>{messages.length}</b>
          </div>
        </div>
      </aside>

      <VoicePanel
        state={voice.state}
        error={voice.error}
        muted={voice.muted}
        channelName={voice.currentChannelName}
        remoteStreams={voice.remoteStreams}
        onToggleMute={voice.toggleMute}
        onLeave={voice.leaveVoice}
      />
    </div>
  );
}

export default App;
