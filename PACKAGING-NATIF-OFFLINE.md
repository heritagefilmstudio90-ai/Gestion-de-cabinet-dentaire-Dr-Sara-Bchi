# Structure Complète & Guide de Packaging Natif Hors Ligne — Gestion de cabinet dentaire Dr. Sara Bchi

Ce guide présente l'architecture complète et les fichiers prêts à compiler pour transformer **Gestion de cabinet dentaire Dr. Sara Bchi (PWA)** en applications natives installables sur **Windows, macOS, Android et iOS**, tout en garantissant rapidité, synchronisation temps réel, connectivité totale et sécurité maximale.

---

## 1. Structure Complète des Dossiers

```text
/
├── dist/                                   # Bundle Vite optimisé (généré par `npm run build`)
├── public/                                 # Icônes PWA (pwa-512x512.png, apple-touch-icon.png, icon.svg)
├── server.ts                               # Backend Express sécurisé (en-têtes HTTP, CORS natif, /api/health, /api/sms/send)
├── firestore.rules                         # Règles RBAC serveur zéro-confiance
├── .env.example                            # Modèle de variables (TWILIO_*, SMS_WEBHOOK_*, VITE_API_BASE_URL)
├── PACKAGING-NATIF-OFFLINE.md              # Ce guide complet
└── native-packaging/
    ├── tauri/                              # 🖥️ Bureau Natif : Windows (.exe / .msi) & macOS (.app / .dmg)
    │   ├── tauri.conf.json                 # Configuration Tauri v2, CSP stricte, bundle & fenêtre
    │   ├── Cargo.toml                      # Manifeste Rust + tauri-plugin-single-instance
    │   ├── build.rs                        # Script de compilation Tauri v2
    │   ├── capabilities/
    │   │   └── default.json                # Permissions minimales de fenêtre (moindre privilège)
    │   └── src/
    │       ├── main.rs                     # Point d'entrée binaire Windows/macOS
    │       └── lib.rs                      # Initialisation Tauri & focus instance unique
    └── capacitor/                          # 📱 Mobile Natif : Android (.apk / .aab) & iOS (.ipa)
        ├── capacitor.config.ts             # Configuration TypeScript Capacitor (HTTPS strict, plugins, sécurité)
        ├── package.native.json             # Dépendances mobiles isolées (@capacitor/android, ios, camera, network...)
        ├── android-permissions.xml         # Permissions caméra, réseau & fichiers pour AndroidManifest.xml
        └── ios-info-plist-keys.xml         # Clés de confidentialité caméra/fichiers pour Info.plist
```

---

## 2. Architecture : Rapide, Synchronisée, Connectée et 100 % Sécurisée

1. **Rapide (Démarrage instantané & découpage de code)** :
   - `vite.config.ts` sépare automatiquement les bibliothèques critiques (`vendor-react`, `vendor-firebase`, `vendor-pdf`, `vendor-ui`) pour un démarrage ultra-rapide dans les WebViews Tauri/Capacitor et un cache incrémental efficace.
   - L'interface complète (`dist/`) est embarquée localement dans l'exécutable : **0 ms de latence réseau au lancement**, même sans Internet.

2. **Synchronisée & Hors Ligne (IndexedDB + Reprise automatique)** :
   - `src/lib/firebase.ts` active `persistentLocalCache` + `persistentMultipleTabManager` avec un quota local étendu à **100 Mo** dans IndexedDB.
   - Tous les dossiers patients, rendez-vous, actes, devis, factures et paiements sont consultables et modifiables hors ligne.
   - Dès le retour du réseau ou le retour au premier plan de l'application, `resyncFirestoreNetwork()` réactive le réseau Firestore et purge automatiquement les écritures en attente (`waitForPendingWrites`).
   - Sur le Web PWA, le Service Worker Workbox (`vite-plugin-pwa`) met en cache tous les assets statiques et notifie automatiquement les mises à jour disponibles.

3. **Totalement Connectée (Temps réel + API Backend)** :
   - Les écouteurs `onSnapshot` synchronisent instantanément l'équipe entre postes Windows/Mac et tablettes/téléphones iOS/Android.
   - Pour les appels backend (`/api/health`, `/api/sms/status`, `/api/sms/send`) depuis les paquets natifs, définissez `VITE_API_BASE_URL` dans `.env.local` avant `npm run build` (voir section 3).

4. **100 % Sécurisée (Zéro-Confiance Client, Natif & Serveur)** :
   - **RBAC strict** : contrôle d'accès par rôle (`titulaire`, `collaborateur`, `secretaire`, `assistant`) appliqué côté logique (`ClinicContext` + `canAccessSection`) **et** côté base (`firestore.rules`).
   - **API protégée** : `/api/sms/send` vérifie systématiquement le jeton Firebase `Authorization: Bearer <ID_TOKEN>` et `server.ts` applique des en-têtes de sécurité (`X-Content-Type-Options`, `Permissions-Policy`, `Referrer-Policy`, `HSTS`) ainsi qu'une liste blanche CORS limitée aux schémas natifs officiels (`tauri://localhost`, `http://tauri.localhost`, `capacitor://localhost`, `https://localhost`).
   - **Tauri v2 durci** : `withGlobalTauri: false`, `object-src 'none'`, `base-uri 'self'`, `capabilities/default.json` limité à `core:default`.
   - **Capacitor durci** : `cleartext: false`, `allowMixedContent: false`, `webContentsDebuggingEnabled: false`.

---

## 3. Configuration Préalable (Variables & Firebase)

### A. Connecter les builds natifs à votre serveur backend (`.env.local`)
À la racine du projet, créez un fichier `.env.local` avant de lancer `npm run build` pour que les apps Windows, macOS, Android et iOS pointent vers votre serveur Express :
```env
VITE_API_BASE_URL="https://ais-pre-tsq472ukkgzhv2xqsfuqx5-1005453407597.europe-west2.run.app"
```

### B. Domaines autorisés dans Firebase Authentication
Dans **Console Firebase → Authentication → Settings → Authorized domains**, vérifiez la présence de :
- `tauri.localhost` *(Windows Tauri)*
- `localhost` *(Capacitor Android/iOS & dev local)*
- Votre domaine Cloud Run (`ais-pre-...run.app`)

> **Authentification recommandée sur bureau/mobile** : utilisez la connexion **Identifiant & Mot de passe** (gérée dans *Équipe & Accès*) pour une fiabilité totale dans toutes les WebViews natives, même hors ligne après la première session.

---

## 4. Packaging Bureau avec Tauri v2 (Windows & macOS)

### Prérequis Système
- **Node.js 20+** et **Rust / Cargo** (`https://rustup.rs`)
- **CLI Tauri v2** : `npm install -g @tauri-apps/cli@^2`
- **Windows 10/11** : Visual Studio C++ Build Tools (*Développement Desktop en C++*) + Microsoft Edge WebView2 Runtime.
- **macOS** : Xcode Command Line Tools (`xcode-select --install`).

### Commandes de Compilation
```bash
# 1. Compiler le bundle frontend optimisé dans /dist
npm install
npm run build

# 2. Générer les icônes natives (.ico Windows, .icns macOS, PNG)
cd native-packaging/tauri
tauri icon ../../public/pwa-512x512.png

# 3. Tester en local (facultatif)
tauri dev

# 4. Générer les installateurs natifs de production
tauri build
```

### Fichiers Générés
- **Windows** :
  - `native-packaging/tauri/target/release/bundle/nsis/Gestion de cabinet dentaire Dr. Sara Bchi_1.0.0_x64-setup.exe`
  - `native-packaging/tauri/target/release/bundle/msi/Gestion de cabinet dentaire Dr. Sara Bchi_1.0.0_x64_en-US.msi`
- **macOS** :
  - `native-packaging/tauri/target/release/bundle/macos/Gestion de cabinet dentaire Dr. Sara Bchi.app`
  - `native-packaging/tauri/target/release/bundle/dmg/Gestion de cabinet dentaire Dr. Sara Bchi_1.0.0_aarch64.dmg` *(ou `_x64.dmg` ; utilisez `tauri build --target universal-apple-darwin` pour un DMG universel).*

---

## 5. Packaging Mobile avec Capacitor (Android & iOS)

Le dossier `/native-packaging/capacitor/` contient `capacitor.config.ts` et `package.native.json` pour isoler les SDK mobiles du projet web principal.

### Prérequis Système
- **Android** : Android Studio (SDK Platform 34+, JDK 17+).
- **iOS (macOS requis)** : Xcode 15+, CocoaPods (`brew install cocoapods`), compte Apple Developer.

### Initialisation & Synchronisation
```bash
# 1. Compiler /dist avec l'URL API si configurée dans .env.local
npm install
npm run build

# 2. Initialiser le workspace Capacitor
cd native-packaging/capacitor
cp package.native.json package.json
npm install

# 3. Créer les projets natifs Android & iOS (à faire une seule fois)
npx cap add android
npx cap add ios   # Sur macOS uniquement
```

### Permissions Natives à Appliquer
- **Android** : ajoutez le contenu de `native-packaging/capacitor/android-permissions.xml` dans `native-packaging/capacitor/android/app/src/main/AndroidManifest.xml` (avant `<application>`).
- **iOS** : ajoutez le contenu de `native-packaging/capacitor/ios-info-plist-keys.xml` dans `native-packaging/capacitor/ios/App/App/Info.plist`.

### Générer `.apk` / `.aab` (Android) et `.ipa` (iOS)
```bash
# À exécuter après chaque modification du code web
cd native-packaging/capacitor
npm run cap:sync

# Ouvrir dans Android Studio pour générer APK/AAB ou installer en USB
npm run cap:open:android

# Ouvrir dans Xcode (macOS) pour signer, tester sur iPhone/iPad ou archiver (.ipa)
npm run cap:open:ios
```

---

## 6. Vérification & Dépannage Rapide

- **Mode Hors Ligne & Cache** : après une première connexion réussie avec un rôle actif, l'application démarre hors ligne grâce à `dist/` embarqué et IndexedDB (100 Mo). Les modifications locales affichent l'indicateur de synchronisation puis sont envoyées automatiquement au retour d'Internet.
- **Impressions & Exports PDF/CSV** : sur Windows/macOS, l'impression A4 utilise le dialogue système natif ; sur mobile, les exports CSV et documents PDF sont générés localement via `jsPDF`.
- **Mises à jour** : mettez à jour `"version"` dans `tauri.conf.json`, `Cargo.toml` et `package.native.json`, puis relancez `npm run build` et `tauri build` / `npm run cap:sync`.
