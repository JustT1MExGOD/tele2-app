# Выпуск приложения для Android

[Документация](README.md) · [Обзор проекта](../README.md)

`android/` — Capacitor-обёртка (WebView-shell) вокруг того же продакшн веб-приложения, что и `desktop/` для Windows: `server.url` в `android/capacitor.config.json` грузит `https://tele2-app-production.up.railway.app` напрямую, отдельного фронтенда для Android не существует.

## Подготовка и сборка

```bash
cd android
npm ci
npx cap sync android
cd android
./gradlew assembleDebug     # неподписанный dev-APK, для установки на свой телефон
./gradlew assembleRelease   # release-APK
./gradlew bundleRelease     # .aab — формат для загрузки в Play Store
```

Результат: `android/android/app/build/outputs/apk/{debug,release}/` и `android/android/app/build/outputs/bundle/release/app-release.aab`.

## Подпись release-сборки

В исходной конфигурации нет настроенного ключа подписи — как и у desktop-приложения (`CSC_LINK`/`CSC_KEY_PASSWORD`, см. [DESKTOP-RELEASE.md](DESKTOP-RELEASE.md)), реальный keystore в репозиторий не добавляют. Без него `assembleRelease`/`bundleRelease` всё равно собираются, но результат неподписан.

Чтобы подписывать локально:

1. Сгенерировать ключ (нужен установленный JDK):
   ```bash
   keytool -genkeypair -v -keystore t2sales-release.jks -alias t2sales -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Положить `t2sales-release.jks` в `android/android/` (гитигнорится).
3. Скопировать `android/android/keystore.properties.example` → `android/android/keystore.properties`, заполнить реальными паролями/алиасом (тоже гитигнорится).
4. `build.gradle` подхватывает `keystore.properties` автоматически, если файл существует — иначе `release`-сборка остаётся неподписанной, сборка не падает.

**Ключ потерять нельзя** — Play Store привязывает приложение к первому загруженному ключу (или к Play App Signing, если включено при первой публикации); без него дальнейшие обновления того же `applicationId` невозможны.

## Значок и публикация в RuStore

RuStore при модерации сверяет значок в карточке приложения со значком установленного приложения; при расхождении приложение отклоняют (требования: https://help.rustore.ru/rustore/for_developers/publishing_and_verifying_apps/requirement_apps).

- Значок приложения — логотип T2 (белые «T2» на синем `#3076E6`) из `docs/screenshots/logo.jpg`: адаптивный значок (`mipmap-anydpi-v26`: фон `@color/ic_launcher_background` + слой `ic_launcher_foreground`), обычные `ic_launcher.png` и `ic_launcher_round.png`, заставка `drawable*/splash.png`.
- **В карточке RuStore загружать `android/store/icon-512.png`** (512×512, тот же логотип). Другую картинку не использовать: именно её расхождение с установленным значком и стало причиной отказа.
- Перед повторной отправкой нужен новый `versionCode` (в `android/android/app/build.gradle`; сейчас `2`, `versionName` `1.0.1`): RuStore не принимает сборку с тем же кодом.
- Собирать подписанный APK (RuStore принимает APK и AAB) нужно с тем же ключом, что и первую версию.

## Нативное приложение

Помимо Capacitor-оболочки в `android/` есть нативное приложение на Kotlin (`native/androidApp`, см. [ANDROID.md](../native/docs/ANDROID.md)). У него тот же `applicationId` `com.t2sales.android` и тот же ключ подписи, `versionCode` начинается с 10: после выхода на паритет оно выпускается в RuStore как обновление этого приложения.

## CI

`.github/workflows/android-ci.yml` на каждый push:

- собирает debug APK (`assembleDebug`) на реальном Android SDK (ubuntu-latest + `actions/setup-java` + `sdkmanager`);
- собирает release APK и AAB (`assembleRelease`/`bundleRelease`);
- если в секретах репозитория настроен `ANDROID_KEYSTORE_BASE64` (+ `ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`), release-сборка получается подписанной; иначе — неподписанной, без падения job'а;
- прикладывает все три артефакта (`t2sales-android-debug-apk`, `t2sales-android-release-apk`, `t2sales-android-release-aab`) к ран.

Секреты (base64-кодированный `.jks` и три пароля/алиас) заводятся в настройках репозитория (Settings → Secrets and variables → Actions) — это изменение конфигурации GitHub, не делается автоматически.

Создание артефакта CI не равно публикации в Play Store — загрузка `.aab` в Play Console делается отдельно, вручную.
