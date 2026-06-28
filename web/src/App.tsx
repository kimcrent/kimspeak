/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import {
  createChannel,
  createGuild,
  createMessage,
  deleteChannel as deleteChannelRequest,
  getMe,
  inviteGuildMember,
  listChannelMembers,
  listChannels,
  listGuilds,
  listMessages,
  login,
  renameChannel as renameChannelRequest,
  register,
} from "./api";
import type { Channel, ChannelMember, Guild, Message, User } from "./api";
import { useVoiceRoom } from "./voice/useVoiceRoom";
import { VoicePanel } from "./voice/VoicePanel";

type AuthMode = "login" | "register";
type ChannelDraftType = "text" | "voice";
type CreateModalType = "guild" | ChannelDraftType;

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

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || "",
  );
  const [user, setUser] = useState<User | null>(null);

  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const [activeGuildId, setActiveGuildId] = useState("");
  const [activeChannelId, setActiveChannelId] = useState("");

  const [createModalType, setCreateModalType] =
    useState<CreateModalType | null>(null);
  const [createName, setCreateName] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [renameName, setRenameName] = useState("");
  const [messageDraft, setMessageDraft] = useState("");

  const [status, setStatus] = useState("Готов к работе");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(() => Boolean(token));
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isRenamingChannel, setIsRenamingChannel] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [deletingChannelId, setDeletingChannelId] = useState("");
  const [renamingChannel, setRenamingChannel] = useState<Channel | null>(null);

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
    activeChannel?.type === "voice" &&
    voice.currentChannelId === activeChannel.id;
  const isActiveVoiceConnecting =
    isActiveVoiceChannelJoined && voice.state === "connecting";

  const activeChannelMemberCount = channelMembers.length;

  const createModalTitle =
    createModalType === "guild"
      ? "Создать сервер"
      : createModalType === "text"
        ? "Создать текстовый канал"
        : "Создать голосовой канал";

  const createModalPlaceholder =
    createModalType === "guild"
      ? "Название сервера"
      : createModalType === "text"
        ? "Название канала"
        : "Название комнаты";

  const createModalIcon =
    createModalType === "guild" ? "K" : createModalType === "voice" ? "♪" : "#";

  function openCreateModal(type: CreateModalType) {
    setCreateModalType(type);
    setRenamingChannel(null);
    setCreateName("");
    setError("");
  }

  function closeCreateModal() {
    if (isWorkspaceLoading) {
      return;
    }

    setCreateModalType(null);
    setCreateName("");
  }

  function openRenameChannelModal(channel: Channel) {
    setRenamingChannel(channel);
    setRenameName(channel.name);
    setCreateModalType(null);
    setError("");
  }

  function closeRenameChannelModal() {
    if (isRenamingChannel) {
      return;
    }

    setRenamingChannel(null);
    setRenameName("");
  }

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
        setStatus(
          items.length ? "Серверы загружены" : "Создайте первый сервер",
        );
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить серверы",
        );
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

          return (
            items.find((channel) => channel.type === "text")?.id ||
            items[0]?.id ||
            ""
          );
        });
        setStatus(items.length ? "Каналы загружены" : "Создайте первый канал");
      })
      .catch((err) => {
        setChannels([]);
        setActiveChannelId("");
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить каналы",
        );
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
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить сообщения",
        );
        setStatus("Ошибка загрузки сообщений");
      })
      .finally(() => {
        setIsMessagesLoading(false);
      });
  }, [activeChannel, activeChannelId, token]);

  useEffect(() => {
    if (!token || !activeChannelId) {
      setChannelMembers([]);
      return;
    }

    let isStale = false;

    setIsMembersLoading(true);

    listChannelMembers(token, activeChannelId)
      .then((items) => {
        if (isStale) {
          return;
        }

        setChannelMembers(items);
      })
      .catch((err) => {
        if (isStale) {
          return;
        }

        setChannelMembers([]);
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось загрузить пользователей канала",
        );
      })
      .finally(() => {
        if (!isStale) {
          setIsMembersLoading(false);
        }
      });

    return () => {
      isStale = true;
    };
  }, [activeChannelId, token]);

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

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !activeGuild || !inviteUsername.trim()) {
      return;
    }

    setIsInviting(true);
    setError("");
    setStatus("Приглашаем пользователя...");

    try {
      const member = await inviteGuildMember(
        token,
        activeGuild.id,
        inviteUsername.trim(),
      );

      setInviteUsername("");
      setChannelMembers((items) => {
        const exists = items.some((item) => item.id === member.id);

        if (exists) {
          return items.map((item) => (item.id === member.id ? member : item));
        }

        return [...items, member];
      });
      setStatus(`Пользователь ${member.username} приглашён`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось пригласить пользователя",
      );
      setStatus("Ошибка приглашения");
    } finally {
      setIsInviting(false);
    }
  }

  async function handleDeleteTextChannel(channelToDelete: Channel) {
    if (!token || channelToDelete.type !== "text") {
      return;
    }

    const confirmed = window.confirm(
      `Удалить текстовый канал #${channelToDelete.name}?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingChannelId(channelToDelete.id);
    setError("");
    setStatus("Удаляем канал...");

    try {
      await deleteChannelRequest(token, channelToDelete.id);

      const nextChannels = channels.filter(
        (channel) => channel.id !== channelToDelete.id,
      );
      setChannels(nextChannels);

      if (activeChannelId === channelToDelete.id) {
        const nextActiveChannel =
          nextChannels.find((channel) => channel.type === "text") ||
          nextChannels[0] ||
          null;

        setActiveChannelId(nextActiveChannel?.id || "");
        setMessages([]);
      }

      setStatus("Канал удалён");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить канал");
      setStatus("Ошибка удаления канала");
    } finally {
      setDeletingChannelId("");
    }
  }

  async function handleRenameChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !renamingChannel || !renameName.trim()) {
      return;
    }

    setIsRenamingChannel(true);
    setError("");
    setStatus("Переименовываем канал...");

    try {
      const channel = await renameChannelRequest(
        token,
        renamingChannel.id,
        renameName.trim().replace(/^#/, ""),
      );

      setChannels((items) =>
        items.map((item) => (item.id === channel.id ? channel : item)),
      );
      setRenamingChannel(null);
      setRenameName("");
      setStatus("Канал переименован");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось переименовать канал",
      );
      setStatus("Ошибка переименования");
    } finally {
      setIsRenamingChannel(false);
    }
  }

  async function handleCreateFromModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !createModalType || !createName.trim()) {
      return;
    }

    setIsWorkspaceLoading(true);
    setError("");

    try {
      if (createModalType === "guild") {
        const guild = await createGuild(token, createName.trim());
        setGuilds((items) => [...items, guild]);
        setActiveGuildId(guild.id);
        setCreateModalType(null);
        setCreateName("");
        setStatus("Сервер создан");
        return;
      }

      if (!activeGuildId) {
        return;
      }

      const channel = await createChannel(
        token,
        activeGuildId,
        createName.trim().replace(/^#/, ""),
        createModalType,
      );
      setChannels((items) => [...items, channel]);
      setActiveChannelId(channel.id);
      setCreateModalType(null);
      setCreateName("");
      setStatus("Канал создан");
    } catch (err) {
      const fallback =
        createModalType === "guild"
          ? "Не удалось создать сервер"
          : "Не удалось создать канал";

      setError(err instanceof Error ? err.message : fallback);
      setStatus(
        createModalType === "guild"
          ? "Ошибка создания сервера"
          : "Ошибка создания канала",
      );
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
      const message = await createMessage(
        token,
        activeChannelId,
        messageDraft.trim(),
      );
      setMessages((items) => [...items, message]);
      setMessageDraft("");
      setStatus("Сообщение отправлено");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось отправить сообщение",
      );
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
    setChannelMembers([]);
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
          <div className="authTitle">
            {mode === "login" ? "Вход" : "Регистрация"}
          </div>

          <div
            className="authTabs"
            role="tablist"
            aria-label="Режим авторизации"
          >
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
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </label>

            <button className="submitButton" disabled={isLoading}>
              {isLoading
                ? "Отправляем..."
                : mode === "login"
                  ? "Войти"
                  : "Создать аккаунт"}
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
              className={
                guild.id === activeGuildId ? "server active" : "server"
              }
              key={guild.id}
              onClick={() => {
                setActiveGuildId(guild.id);
                closeCreateModal();
              }}
              title={guild.name}
              type="button"
            >
              {getInitial(guild.name)}
            </button>
          ))}
          <button
            className="server addServer"
            disabled={isWorkspaceLoading}
            onClick={() => openCreateModal("guild")}
            title="Создать сервер"
            type="button"
          >
            +
          </button>
        </div>
      </aside>

      <aside className="channels">
        <div className="guildTitle">
          <div>
            <span>{activeGuild?.name || "Нет сервера"}</span>
            <small>{isWorkspaceLoading ? "Синхронизация..." : status}</small>
          </div>
        </div>

        <div className="channelScroll">
          <div className="channelBlock">
            <div className="channelCategoryRow">
              <div className="channelCategory">Текстовые каналы</div>
              <button
                aria-label="Создать текстовый канал"
                className="channelActionButton"
                disabled={!activeGuild || isWorkspaceLoading}
                onClick={() => openCreateModal("text")}
                title="Создать текстовый канал"
                type="button"
              >
                +
              </button>
            </div>

            {textChannels.map((channel) => (
              <div className="channelRow" key={channel.id}>
                <button
                  className={
                    channel.id === activeChannelId
                      ? "channel active"
                      : "channel"
                  }
                  onClick={() => setActiveChannelId(channel.id)}
                  type="button"
                >
                  <span className="channelIcon">#</span>
                  <span className="channelName">{channel.name}</span>
                </button>
                <button
                  aria-label={`Переименовать текстовый канал ${channel.name}`}
                  className="channelEditButton"
                  onClick={() => openRenameChannelModal(channel)}
                  title={`Переименовать #${channel.name}`}
                  type="button"
                >
                  ✎
                </button>
                <button
                  aria-label={`Удалить текстовый канал ${channel.name}`}
                  className="channelDeleteButton"
                  disabled={deletingChannelId === channel.id}
                  onClick={() => handleDeleteTextChannel(channel)}
                  title={`Удалить #${channel.name}`}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}

            {!textChannels.length && (
              <div className="emptyHint">Пока нет текстовых каналов</div>
            )}
          </div>

          <div className="channelBlock">
            <div className="channelCategoryRow">
              <div className="channelCategory">Голосовые каналы</div>
              <button
                aria-label="Создать голосовой канал"
                className="channelActionButton"
                disabled={!activeGuild || isWorkspaceLoading}
                onClick={() => openCreateModal("voice")}
                title="Создать голосовой канал"
                type="button"
              >
                +
              </button>
            </div>

            {voiceChannels.map((channel) => {
              const isCurrentVoiceChannel =
                voice.currentChannelId === channel.id &&
                voice.state !== "error";

              const usersInChannel = isCurrentVoiceChannel
                ? voice.voiceUsers
                : [];

              return (
                <div className="voiceChannelTree" key={channel.id}>
                  <div className="channelRow voiceChannelActionRow">
                    <button
                      className={
                        channel.id === activeChannelId || isCurrentVoiceChannel
                          ? "voiceChannelHeader active"
                          : "voiceChannelHeader"
                      }
                      onClick={() => {
                        setActiveChannelId(channel.id);

                        if (!isCurrentVoiceChannel) {
                          handleJoinVoiceChannel(channel);
                        }
                      }}
                      type="button"
                    >
                      <span className="voiceChannelIcon">♪</span>
                      <span className="voiceChannelName">{channel.name}</span>

                      {isCurrentVoiceChannel && (
                        <span className="voiceChannelState">Внутри</span>
                      )}
                    </button>
                    <button
                      aria-label={`Переименовать голосовой канал ${channel.name}`}
                      className="channelEditButton"
                      onClick={() => openRenameChannelModal(channel)}
                      title={`Переименовать ${channel.name}`}
                      type="button"
                    >
                      ✎
                    </button>
                  </div>

                  {usersInChannel.length > 0 && (
                    <div className="voiceChannelMembers">
                      {usersInChannel.map((voiceUser) => {
                        const displayName = voiceUser.username || voiceUser.id;

                        return (
                          <div
                            className="voiceChannelMember"
                            key={voiceUser.id}
                          >
                            <div className="voiceChannelMemberAvatar">
                              {displayName.slice(0, 1).toUpperCase()}
                            </div>

                            <div className="voiceChannelMemberName">
                              {displayName}
                            </div>

                            <div className="voiceChannelMemberIcons">
                              <span title="Микрофон">🎤</span>
                              <span title="Звук">🎧</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {!voiceChannels.length && (
              <div className="emptyHint emptyHintWithAction">
                <span>Пока нет голосовых каналов</span>
                <button
                  className="emptyActionButton"
                  disabled={isWorkspaceLoading || !activeGuild}
                  onClick={() => openCreateModal("voice")}
                  type="button"
                >
                  Создать голосовой
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="profilePanel">
          <div className="profileAvatar">{getInitial(user.username)}</div>
          <div className="profileInfo">
            <div className="profileName">{user.username}</div>
            <div className="profileStatus online">online</div>
          </div>
          <button
            className="profileLogout"
            onClick={logout}
            title="Выйти"
            type="button"
          >
            ⏻
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <strong>
              {activeChannel?.type === "voice" ? "♪" : "#"}{" "}
              {activeChannel?.name || "канал не выбран"}
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
              <p>
                Текстовый канал нужен для сообщений, голосовой можно оставить
                как комнату.
              </p>
            </div>
          )}

          {activeChannel?.type === "voice" && (
            <div className="voiceRoom">
              <div className="pulse">♪</div>
              <h2>{activeChannel.name}</h2>
              <p>
                Голосовая комната готова. Текстовые сообщения доступны в каналах
                с #.
              </p>
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

          {activeChannel?.type === "text" &&
            !isMessagesLoading &&
            !messages.length && (
              <div className="emptyState">
                <h2>Тут пока тихо</h2>
                <p>Напишите первое сообщение в #{activeChannel.name}.</p>
              </div>
            )}

          {activeChannel?.type === "text" &&
            messages.map((message) => {
              const isOwn = message.author_id === user.id;
              const authorName = isOwn
                ? user.username
                : `user-${message.author_id.slice(0, 6)}`;

              return (
                <article
                  className={isOwn ? "message ownMessage" : "message"}
                  key={message.id}
                >
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
            disabled={
              !activeChannel || activeChannel.type !== "text" || isSending
            }
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
              !activeChannel ||
              activeChannel.type !== "text" ||
              !messageDraft.trim() ||
              isSending
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
          <form className="inviteForm" onSubmit={handleInviteMember}>
            <input
              disabled={!activeGuild || isInviting}
              onChange={(event) => setInviteUsername(event.target.value)}
              placeholder="Username"
              value={inviteUsername}
            />
            <button
              disabled={!activeGuild || !inviteUsername.trim() || isInviting}
              type="submit"
            >
              {isInviting ? "..." : "Пригласить"}
            </button>
          </form>
        </div>

        <div className="membersPanel">
          <div className="membersTitle">
            Пользователи канала
            {activeChannel && (
              <span>{isMembersLoading ? "..." : activeChannelMemberCount}</span>
            )}
          </div>

          {!activeChannel && (
            <div className="emptyHint">Выберите канал</div>
          )}

          {activeChannel && isMembersLoading && (
            <div className="emptyHint">Загружаем пользователей...</div>
          )}

          {activeChannel && !isMembersLoading && !channelMembers.length && (
            <div className="emptyHint">В канале пока никого нет</div>
          )}

          {activeChannel &&
            !isMembersLoading &&
            channelMembers.map((member) => (
              <div
                className={member.id === user.id ? "member current" : "member"}
                key={member.id}
              >
                <div className="memberAvatar">
                  {getInitial(member.username)}
                </div>
                <div className="memberInfo">
                  <div className="memberName">{member.username}</div>
                </div>
                <span className={`memberRole ${member.role}`}>
                  {member.role}
                </span>
              </div>
            ))}
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
            <span>Пользователи</span>
            <b>{activeChannel ? activeChannelMemberCount : 0}</b>
          </div>
        </div>
      </aside>

      {createModalType && (
        <div
          className="modalBackdrop"
          onMouseDown={closeCreateModal}
          role="presentation"
        >
          <section
            aria-labelledby="create-modal-title"
            aria-modal="true"
            className="createModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="createModalHeader">
              <div className="createModalIcon">{createModalIcon}</div>
              <div>
                <h2 id="create-modal-title">{createModalTitle}</h2>
              </div>
            </div>

            <form className="createModalForm" onSubmit={handleCreateFromModal}>
              <input
                autoFocus
                disabled={isWorkspaceLoading}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={createModalPlaceholder}
                value={createName}
              />
              <div className="createModalActions">
                <button
                  className="createModalSecondary"
                  onClick={closeCreateModal}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className="createModalPrimary"
                  disabled={isWorkspaceLoading || !createName.trim()}
                >
                  {isWorkspaceLoading ? "Создаём..." : "Создать"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {renamingChannel && (
        <div
          className="modalBackdrop"
          onMouseDown={closeRenameChannelModal}
          role="presentation"
        >
          <section
            aria-labelledby="rename-modal-title"
            aria-modal="true"
            className="createModal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="createModalHeader">
              <div className="createModalIcon">
                {renamingChannel.type === "voice" ? "♪" : "#"}
              </div>
              <div>
                <h2 id="rename-modal-title">Переименовать канал</h2>
              </div>
            </div>

            <form className="createModalForm" onSubmit={handleRenameChannel}>
              <input
                autoFocus
                disabled={isRenamingChannel}
                onChange={(event) => setRenameName(event.target.value)}
                placeholder="Новое название"
                value={renameName}
              />
              <div className="createModalActions">
                <button
                  className="createModalSecondary"
                  onClick={closeRenameChannelModal}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className="createModalPrimary"
                  disabled={isRenamingChannel || !renameName.trim()}
                >
                  {isRenamingChannel ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

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
