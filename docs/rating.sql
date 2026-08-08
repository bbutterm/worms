-- Серверная часть рейтинга. НЕ ПРИМЕНЕНО: это заготовка на утро.
--
-- Зачем вообще сервер. Сейчас рейтинг лежит на устройстве игрока, и это
-- честно ровно до первого, кто откроет консоль браузера: результат боя
-- сообщает клиент, проверить его некому. Пока играют свои — не беда;
-- как только рейтинг станет общим, нужна сторона, которой можно верить.
--
-- Где создавать. Рекомендую ОТДЕЛЬНЫЙ проект Supabase под игру: тогда
-- ключ в клиенте не имеет никакого отношения к чужим данным. Если всё же
-- в существующем проекте — таблицы ниже добавляются, ничего не меняя в
-- уже имеющихся, и живут под своим префиксом.
--
-- Применять: SQL Editor проекта → вставить → Run.

create table if not exists worms_player (
  id          text primary key,          -- tg<id> или анонимный g<...>
  name        text not null,
  rating      int  not null default 1000,
  wins        int  not null default 0,
  losses      int  not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists worms_match (
  id          bigserial primary key,
  room        text not null,
  winner      text not null references worms_player(id),
  loser       text not null references worms_player(id),
  delta       int  not null,
  -- Обе стороны присылают итог независимо; засчитывается он только когда
  -- оба сказали одно и то же. Это не защита от сговора, но от одиночной
  -- приписки победы — да.
  confirmed   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (room)
);

-- Читать таблицу лидеров может кто угодно, писать — никто напрямую.
alter table worms_player enable row level security;
alter table worms_match  enable row level security;

create policy "лидерборд виден всем"
  on worms_player for select using (true);

-- Записи делает только Edge Function под service_role: она проверяет
-- подпись initData ботом и сверяет отчёты обеих сторон. Клиенту прямая
-- запись не разрешена намеренно — иначе рейтинг рисуется в консоли.

create index if not exists worms_player_rating_idx on worms_player (rating desc);

-- Что останется сделать после применения:
--   1) Edge Function `report-match`: принимает initData + итог, проверяет
--      подпись HMAC-SHA256 по токену бота, пишет в worms_match, при
--      confirmed = true пересчитывает Эло обоим игрокам.
--   2) В src/platform/player.js заменить локальное хранение на вызов этой
--      функции; интерфейс (player/recordResult/eloDelta) для этого и
--      выделен отдельным модулем.
