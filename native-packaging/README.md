# `native-packaging/` — Empaquetage Natif Hors Ligne (Windows, macOS, Android, iOS)

Ce dossier regroupe tous les fichiers nécessaires pour encapsuler la PWA **Gestion de cabinet dentaire Dr. Sara Bchi** (`dist/` + icônes `public/*.png`) en applications natives installables :

```text
native-packaging/
├── README.md                       # Documentation rapide du dossier
├── scripts/
│   ├── package-native.mjs          # Orchestrateur Node.js unifié (--check, --desktop, --mobile)
│   ├── prepare-icons.mjs           # Mappe les icônes PWA existantes (/public/pwa-*.png) vers Tauri & Capacitor
│   ├── build-desktop.sh            # Script de build Tauri v2 (macOS / Linux)
│   ├── build-desktop.ps1           # Script de build Tauri v2 Windows (.exe / .msi)
│   ├── build-mobile.sh             # Script de build Capacitor Android & iOS (macOS / Linux)
│   └── build-mobile.ps1            # Script de build Capacitor Android (Windows)
├── tauri/
│   ├── tauri.conf.json             # Configuration Tauri v2 (CSP stricte, fenêtre, bundle, icônes)
│   ├── Cargo.toml                  # Dépendances Rust + tauri-plugin-single-instance
│   ├── build.rs                    # Script de build Tauri v2
│   ├── capabilities/default.json   # Permissions minimales
│   └── src/{main.rs,lib.rs}        # Point d'entrée desktop
└── capacitor/
    ├── capacitor.config.ts         # Configuration Capacitor (HTTPS strict, navigation, SplashScreen)
    ├── package.native.json         # Dépendances mobiles isolées (@capacitor/android, ios, assets...)
    ├── android-permissions.xml     # Permissions caméra/stockage pour AndroidManifest.xml
    └── ios-info-plist-keys.xml     # Clés caméra/fichiers pour Info.plist
```

## Exécution Rapide depuis la Racine du Projet

- **Vérifier l'environnement et valider les configurations :** `npm run native:check`
- **Préparer les icônes à partir de `/public` :** `npm run native:icons`
- **Générer l'application macOS (`.app` / `.dmg`) :** `npm run native:desktop`
- **Générer l'installateur Windows (`.exe` / `.msi`) :** `npm run native:desktop:win`
- **Préparer & synchroniser Android + iOS (macOS) :** `npm run native:mobile`
- **Préparer & synchroniser Android (Windows) :** `npm run native:mobile:win`

Consultez `PACKAGING-NATIF-OFFLINE.md` à la racine pour le guide détaillé des prérequis et de la signature applicative.
