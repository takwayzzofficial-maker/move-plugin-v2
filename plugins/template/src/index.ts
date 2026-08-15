/**
 * Move-to-me Plugin для Revenge — v2, без backend
 * -------------------------------------------------------------
 * Добавляет стрелочку рядом с именем пользователя в voice-панели.
 * По нажатию плагин сам, используя твой пользовательский токен
 * (достаётся из рантайма Discord, не хранится в конфиге), шлёт
 * PATCH /guilds/{guildId}/members/{userId} с channel_id — это
 * перемещает участника в твой текущий голосовой канал.
 *
 * ВАЖНО — прочти:
 * Это работает только потому, что у ТЕБЯ есть право Move Members
 * на сервере. Технически это подпадает под понятие "self-bot"
 * (автоматизация действий от лица юзерского токена в обход
 * официального клиента), что запрещено Discord ToS. Используешь
 * осознанно, на свой риск — как и договорились.
 *
 * Два места ниже помечены [TODO: ПРОВЕРИТЬ] — их нужно свериться
 * через Revenge DevTools на актуальной версии клиента, см. README.
 */

import { findByProps, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

// ---------- Модули Discord ----------
const VoiceStateStore = findByStoreName("VoiceStateStore");
const UserStore = findByStoreName("UserStore");

// Модуль с методом .patch — тот же, которым сам Discord делает
// REST-запросы (найден в примере плагина Voice Chat Utilities
// для Vencord: findByProps("V8APIError", "patch"))
// [TODO: ПРОВЕРИТЬ] на мобильном рантайме Revenge может называться
// иначе — проверь через DevTools, см. README
const RestAPI = findByProps("V8APIError", "patch") ?? findByProps("patch", "get", "post");

// [TODO: ПРОВЕРИТЬ] — компонент, рендерящий строку участника в voice-панели
const VoiceUserRow = findByProps("VoiceUser")?.VoiceUser
  ?? findByProps("default")?.default;

let patches = [];
let cachedToken = null;

/**
 * Достаёт токен текущей сессии из рантайма Discord.
 * Не хранится нигде на диске — читается заново при каждом
 * перезапуске приложения (после релогина плагин сам подхватит
 * новый токен).
 */
function getUserToken() {
  if (cachedToken) return cachedToken;
  try {
    // TokenModule обычно лежит среди модулей аутентификации
    const tokenModule = findByProps("getToken");
    const token = tokenModule?.getToken?.();
    if (token) {
      cachedToken = token;
      return token;
    }
  } catch (e) {
    console.log("[move-plugin] не удалось достать токен:", e);
  }
  return null;
}

function getMyVoiceChannelId() {
  const myId = UserStore.getCurrentUser()?.id;
  if (!myId) return null;
  const state = VoiceStateStore.getVoiceStateForUser(myId);
  return state?.channelId ?? null;
}

async function moveUser(targetUserId) {
  const destinationChannelId = getMyVoiceChannelId();
  if (!destinationChannelId) {
    showToast("Ты сейчас не в голосовом канале", { type: "error" });
    return;
  }

  const token = getUserToken();
  if (!token) {
    showToast("Не удалось получить токен сессии", { type: "error" });
    return;
  }

  if (!RestAPI?.patch) {
    showToast("move-plugin: не найден REST-модуль, см. лог", { type: "error" });
    console.log("[move-plugin] RestAPI не найден — см. TODO в index.js");
    return;
  }

  // Достаём guildId из voice state целевого пользователя
  const targetVoiceState = VoiceStateStore.getVoiceStateForUser(targetUserId);
  const guildId = targetVoiceState?.guildId;

  if (!guildId) {
    showToast("Не удалось определить сервер пользователя", { type: "error" });
    return;
  }

  try {
    await RestAPI.patch({
      url: `/guilds/${guildId}/members/${targetUserId}`,
      headers: { authorization: token },
      body: { channel_id: destinationChannelId },
    });
    showToast("Пользователь перемещён", { type: "success" });
  } catch (e) {
    showToast("Ошибка перемещения — см. лог", { type: "error" });
    console.log("[move-plugin] ошибка запроса:", e);
  }
}

// ---------- Кнопка-стрелочка ----------
function ArrowButton({ userId }) {
  const myId = UserStore.getCurrentUser()?.id;
  if (userId === myId) return null;

  return React.createElement(
    ReactNative.TouchableOpacity,
    {
      onPress: () => moveUser(userId),
      style: { paddingHorizontal: 8, justifyContent: "center" },
    },
    React.createElement(ReactNative.Text, { style: { fontSize: 18 } }, "➡️")
  );
}

export const onLoad = () => {
  if (!VoiceUserRow) {
    showToast("move-plugin: не найден компонент voice-панели, см. лог", { type: "error" });
    console.log("[move-plugin] VoiceUserRow не найден — см. TODO в index.js и README");
    return;
  }

  patches.push(
    after("default", VoiceUserRow, (args, res) => {
      // [TODO: ПРОВЕРИТЬ] реальный путь к userId — см. README, шаг с console.log
      const userId = args?.[0]?.user?.id ?? args?.[0]?.userId;
      if (!userId || !res?.props?.children) return res;

      const children = Array.isArray(res.props.children)
        ? res.props.children
        : [res.props.children];

      children.push(React.createElement(ArrowButton, { userId, key: "move-arrow" }));
      res.props.children = children;
      return res;
    })
  );
};

export const onUnload = () => {
  patches.forEach((unpatch) => unpatch());
  patches = [];
};
