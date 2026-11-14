# Spécification de Sécurité & Audit Zero-Trust — DentaFlow Pro

## 1. Invariants de Données & Contrôle d'Accès (RBAC)

1. **Identité vérifiée obligatoire** : Toute opération de lecture ou d'écriture exige `request.auth != null && request.auth.token.email_verified == true`.
2. **Gouvernance RBAC stricte** :
   - Seul le Praticien Titulaire (ou l'administrateur initial `heritagefilmstudio90@gmail.com`) peut créer/modifier les rôles dans `/staff`, gérer `/staffInvites`, modifier `/settings`, enregistrer des charges `/expenses`, clôturer la caisse `/cashClosures` ou modifier le catalogue `/actsCatalog`.
   - Un utilisateur ne peut jamais s'auto-attribuer le rôle `titulaire` à l'inscription sauf s'il s'agit de l'administrateur initial ou d'une invitation validée.
   - Le Praticien Collaborateur ne peut lire/éditer que les patients qui lui sont attribués (`assignedPractitionerId == request.auth.uid`), ses propres rendez-vous, ses plans de traitement, ses commandes labo et consulter uniquement ses honoraires (`practitionerId == request.auth.uid`).
   - La Secrétaire / Accueil peut gérer les rendez-vous, pré-réservations, rappels, l'identité/mutuelle des patients (sans modifier l'odontogramme clinique), les factures et encaissements du jour, et consulter les documents médicaux pour impression. Elle n'a pas accès aux charges directionnelles ni à la clôture globale verrouillée.
   - L'Assistant(e) Dentaire peut consulter le planning, téléverser des clichés d'imagerie, assister la saisie de l'odontogramme et gérer exclusivement le stock et les mouvements de consommables, sans aucun accès aux données comptables (`invoices`, `payments`, `expenses`, `cashClosures`).
3. **Intégrité Comptable & Verrouillage** :
   - Les clôtures de caisse (`locked == true`) sont immuables après validation (sauf correction par le Praticien Titulaire).
   - Les factures annulées ou intégralement payées ne peuvent plus voir leur montant total ou leur numéro altéré par des rôles non-titulaires.
   - Les champs `createdBy` et `createdAt` sont immuables après création et validés contre `request.auth.uid` et `request.time`.

## 2. Les 12 Charges d'Attaque ("Dirty Dozen")

1. **Escalade de Privilège à l'Inscription** : Un nouvel utilisateur crée `/staff/{uid}` avec `role: "titulaire"` sans être l'admin initial ni titulaire d'une invitation. → **Attendu : PERMISSION_DENIED**.
2. **Modification de son propre rôle** : Une secrétaire met à jour `/staff/{uid}` avec `role: "titulaire"`. → **Attendu : PERMISSION_DENIED**.
3. **Shadow Update sur Patient** : Ajout d'un champ fantôme `isAdminBypass: true` lors de la mise à jour d'un patient. → **Attendu : PERMISSION_DENIED** (bloqué par `hasOnly`).
4. **Accès Assistant à la Caisse** : Un compte `assistant` tente un `get`/`list` sur `/invoices` ou `/payments`. → **Attendu : PERMISSION_DENIED**.
5. **Secrétaire modifiant l'Odontogramme** : Un compte `secretaire` tente de modifier le champ `odontogram` d'un patient. → **Attendu : PERMISSION_DENIED**.
6. **Collaborateur consultant les honoraires d'un confrère** : Un compte `collaborateur` tente de lire `/invoices/{id}` où `practitionerId != request.auth.uid`. → **Attendu : PERMISSION_DENIED**.
7. **ID Poisoning** : Création d'un document avec un ID de 300 caractères ou contenant des caractères spéciaux (`/patients/..hack..`). → **Attendu : PERMISSION_DENIED** (`isValidId`).
8. **Spoofing d'Auteur** : Création d'un paiement avec `createdBy: "autre-uid"`. → **Attendu : PERMISSION_DENIED**.
9. **Falsification Temporelle** : Création d'une facture avec `createdAt` antidaté côté client au lieu de `request.time`. → **Attendu : PERMISSION_DENIED**.
10. **Altération d'une Clôture Verrouillée** : Tentative de modification d'un document `/cashClosures/{id}` ayant `locked: true` par un non-titulaire. → **Attendu : PERMISSION_DENIED**.
11. **Usurpation d'Email non vérifié** : Requête avec `email_verified: false`. → **Attendu : PERMISSION_DENIED**.
12. **Épuisement de Ressources (Value Poisoning)** : Envoi d'une chaîne de 2 Mo dans `notes` ou `firstName`. → **Attendu : PERMISSION_DENIED** (limites `.size()`).
