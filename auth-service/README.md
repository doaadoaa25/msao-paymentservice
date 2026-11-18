# MSOA — Microservice Auth (port 8081)

Microservice d'authentification du TP « Building a Microservices-Oriented Application »
(dépôt du professeur : https://github.com/ZOUHEIRBN/MSOA-E-com-Demo).

**Stack :** Python · FastAPI · SQLite + SQLAlchemy · JWT (PyJWT, HS256) · Argon2id (argon2-cffi) · Pydantic · Pytest

| Méthode | Endpoint | Auth requise | Succès | Erreurs |
|---|---|---|---|---|
| POST | `/api/auth/register` | non | **201** → `{id, name, email, role}` | 409 email déjà pris · 422 validation |
| POST | `/api/auth/login` | non | **200** → `{user: {id, name, email, role}, token}` | 401 identifiants invalides · 422 |
| POST | `/api/auth/logout` | Bearer (facultatif) | **200** → `{success: true, message}` | — (idempotent) |
| GET | `/api/auth/me` | **Bearer obligatoire** | **200** → `{id, name, email, role}` | 401 absent / invalide / expiré / révoqué |
| GET | `/health` | non | 200 → `{status: "UP"}` | *(ajout, hors contrat)* |

Toutes les erreurs ont la forme `{"message": "..."}` (c'est ce que lit `apiClient.js`).

---

## 1. Ce que j'ai analysé dans le dépôt du professeur

| Fichier du dépôt | Ce qu'il impose au service Auth |
|---|---|
| `README.md` §5 | Les 4 endpoints, port 8081, login renvoie `user` + `token`, mots de passe jamais en clair, CORS pour Vite |
| `src/services/authService.js` | Corps login `{email, password}` ; corps register `{name, email, password}` ; la réponse login **doit** contenir `user` et `token` sinon erreur « Invalid authentication response. » ; `/me` doit renvoyer **l'objet user directement** (pas `{user: ...}`) car il est passé tel quel à `setUser()` |
| `src/services/apiClient.js` | Envoie `Authorization: Bearer <token>` ; lit le message d'erreur dans **`error.message`** → le format FastAPI par défaut (`detail`) ne s'afficherait pas ; un `204` est accepté |
| `src/context/AuthContext.jsx` | Au chargement, appelle `/me` pour restaurer la session ; si `/me` échoue, la session locale est supprimée |
| `src/pages/Account.jsx`, `Navbar.jsx` | Affichent `user.name`, `user.email`, `user.role` |
| `src/pages/Orders.jsx`, `Checkout.jsx` | Utilisent `user.id` comme `userId` pour Orders |
| `src/pages/Login.jsx` | Mot de passe `minLength: 6` ; message « Account created! » après register |
| Mock (`authService.js`) | Utilisateur démo `id: "user-1"`, `role: "CUSTOMER"` ; messages « Invalid email or password. », « Email already registered. », « All fields are required. » ; emails normalisés en minuscules |
| `MSOA_TP_SQLite_6_Services_*.zip` → `auth/schema.sql` | Table `users(id TEXT PK, name, email UNIQUE, password_hash, role DEFAULT 'CUSTOMER', created_at TEXT)` — reprise **à l'identique** |
| Zip → `README.md` | « Le placeholder fourni n'est PAS un hash » → remplacé automatiquement par un vrai hash Argon2 |

---

## 2. Structure du projet

```
auth-service/
├── app/
│   ├── __init__.py
│   ├── main.py            # Application FastAPI, CORS, format des erreurs
│   ├── config.py          # Lecture des variables d'environnement (.env)
│   ├── database.py        # Connexion SQLite / SQLAlchemy
│   ├── models.py          # Tables users et revoked_tokens
│   ├── schemas.py         # Validation Pydantic des JSON
│   ├── security.py        # Argon2 + création / vérification JWT
│   ├── dependencies.py    # Contrôle d'accès (Bearer token)
│   ├── seed.py            # Compte démo demo@msoa.shop / demo123
│   └── routers/
│       ├── __init__.py
│       └── auth.py        # Les 4 endpoints /api/auth/*
├── tests/
│   ├── __init__.py
│   ├── conftest.py        # Base de test temporaire + client HTTP
│   └── test_auth.py       # 29 tests automatisés
├── frontend-integration/
│   └── backend.js         # Version à copier dans src/config/backend.js
├── docs/
│   └── preuve-frontend-account.png
├── .env.example
├── .gitignore
├── pytest.ini
├── requirements.txt
└── README.md
```

---

## 3. Installation et lancement (Windows PowerShell)

Prérequis : **Python 3.11, 3.12 ou 3.13** (`python --version`) et Node.js pour le frontend.

```powershell
# 1. Aller dans le dossier du service
cd auth-service

# 2. Créer et activer l'environnement virtuel
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # autorise l'activation pour cette fenêtre
.\.venv\Scripts\Activate.ps1

# 3. Installer les dépendances
python -m pip install --upgrade pip
pip install -r requirements.txt

# 4. Créer le fichier .env à partir de l'exemple
Copy-Item .env.example .env

# 5. Générer un secret JWT et le coller dans .env (ligne JWT_SECRET_KEY=...)
python -c "import secrets; print(secrets.token_urlsafe(48))"
notepad .env

# 6. Lancer le service sur le port 8081
uvicorn app.main:app --reload --port 8081
```

Au premier démarrage, `auth.db` est créé et le compte `demo@msoa.shop / demo123` (id `user-1`) est inséré.

> **Important :** lancer `uvicorn` **depuis le dossier `auth-service`**, sinon le fichier `.env` n'est pas trouvé.

**Option – utiliser la base fournie par le professeur :** copier `msoa_sqlite_databases/auth/auth.db` dans `auth-service/`. Au démarrage, le faux hash `DEMO_ONLY_REPLACE_WITH_REAL_PASSWORD_HASH` est remplacé par un hash Argon2 de `demo123`, et la table `revoked_tokens` est ajoutée.

---

## 4. Tests automatisés (Pytest)

```powershell
cd auth-service
.\.venv\Scripts\Activate.ps1
python -m pytest -v
```

Résultat attendu : **29 passed**. Les tests utilisent une base SQLite temporaire (la vraie `auth.db` n'est jamais touchée).

Ce qui est testé :

- **register** : 201 + champs exacts, mot de passe jamais renvoyé, hash Argon2id en base, email normalisé, 409 sur doublon (même avec majuscules), rôle `ADMIN` envoyé par le client ignoré, 422 avec `message` (email invalide, mot de passe < 6, nom vide, champ manquant) ;
- **login** : 200 `{user, token}` pour le compte démo et un nouveau compte, 401 même message pour mauvais mot de passe et email inconnu, contenu du JWT ;
- **me** : 200 avec token, 401 sans token / token invalide / token signé avec un autre secret / token expiré / token `alg=none` ;
- **logout** : le token est révoqué (puis `/me` → 401), seul le token présenté est révoqué, logout sans token et double logout → 200 ;
- **CORS** : `http://localhost:5173` autorisé, origine inconnue refusée ;
- **compatibilité** avec la base du professeur (placeholder remplacé).

---

## 5. Tester avec Swagger

1. Lancer le service puis ouvrir **http://localhost:8081/docs**.
2. **POST /api/auth/register** → *Try it out* → corps :
   ```json
   {"name": "Sara Test", "email": "sara@example.com", "password": "secret123"}
   ```
   → *Execute* → **201** avec `id, name, email, role`. Ré-exécuter → **409** `{"message": "Email already registered."}`.
3. **POST /api/auth/login** → corps `{"email": "demo@msoa.shop", "password": "demo123"}` → **200**. Copier la valeur de `token` (sans guillemets).
4. Cliquer sur **Authorize** 🔒 en haut à droite, coller le token (sans écrire `Bearer`), *Authorize*, *Close*.
5. **GET /api/auth/me** → **200** avec l'utilisateur `user-1`.
6. **POST /api/auth/logout** → **200** `{"success": true, ...}`.
7. Rejouer **GET /api/auth/me** → **401** `{"message": "Token has been revoked."}`.
8. Cas d'erreur : login avec un mauvais mot de passe → **401** ; `/me` après *Logout* dans la fenêtre Authorize → **401** « Authentication required. ».

Test rapide en PowerShell (sans Swagger) :

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/auth/login `
  -ContentType "application/json" -Body '{"email":"demo@msoa.shop","password":"demo123"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod -Uri http://localhost:8081/api/auth/me -Headers $headers
Invoke-RestMethod -Method Post -Uri http://localhost:8081/api/auth/logout -Headers $headers
Invoke-RestMethod -Uri http://localhost:8081/api/auth/me -Headers $headers   # -> erreur 401
```

---

## 6. Intégration avec le frontend React

**Seul fichier modifié : `src/config/backend.js`** (voir `frontend-integration/backend.js`) :

```javascript
const BACKEND_MODE = {
  AUTH: "rest",        // <- seul changement
  CATALOG: "mock",
  INVENTORY: "mock",
  ORDERS: "mock",
  PAYMENTS: "mock",
  SHIPPING: "mock",
};
```

`API_URLS.AUTH` vaut déjà `http://localhost:8081` : rien d'autre à changer.

Lancement (2 fenêtres PowerShell) :

```powershell
# Fenêtre 1 : Auth
cd auth-service; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8081

# Fenêtre 2 : frontend
cd MSOA-E-com-Demo; npm install; npm run dev
```

Puis http://localhost:5173 :

1. Login → *Create an Account* → créer un compte → « Account created! You can now sign in. »
2. Recréer le même compte → « Email already registered. »
3. Se connecter avec un mauvais mot de passe → « Invalid email or password. »
4. Se connecter avec `demo@msoa.shop / demo123` → navbar « Demo Customer ».
5. Page *My Account* → nom, email, rôle `CUSTOMER` (capture : `docs/preuve-frontend-account.png`).
6. Recharger la page (F5) → toujours connecté (session restaurée par `GET /me`).
7. *Logout* → retour à l'accueil ; l'ancien token est refusé par `/me` (401).

> Conseil : avant de passer en mode `rest`, vider le `localStorage` du navigateur (F12 → Application → Local Storage → supprimer `msoa-shop-session`). Un ancien token `mock-...` serait refusé par `/me` (la session est alors simplement effacée).

Ce scénario a été exécuté automatiquement dans un navigateur sur le vrai frontend. Requêtes observées :
`register 201 → register 409 → login 401 → login 200 → me 200 → logout 200 → me (ancien token) 401`.

---

## 7. Logout et révocation des JWT — choix expliqué

Un JWT est **sans état** : le serveur ne garde rien, il vérifie seulement la signature et la date d'expiration. Supprimer le token du navigateur ne suffit donc pas : quelqu'un qui l'aurait copié pourrait encore l'utiliser jusqu'à son expiration.

**Solution retenue : liste de révocation (denylist) en base.**

- Chaque token contient un identifiant unique `jti`.
- `POST /logout` enregistre ce `jti` dans la table `revoked_tokens` avec sa date d'expiration.
- `GET /me` (et toute route protégée du service) refuse un token dont le `jti` est révoqué → 401.
- Les entrées expirées sont nettoyées à chaque logout (un token expiré est de toute façon refusé).
- Seul le token présenté est révoqué : une session ouverte sur un autre navigateur reste valide.

**Logout idempotent :** si le token est absent, invalide ou déjà expiré, la réponse est quand même 200. Raison concrète, vue dans le code React : `authService.logout()` relance l'erreur reçue, et `AuthContext.logout()` ne ferait alors jamais `setUser(null)` — l'interface resterait affichée « connectée ».

**Limite à annoncer :** la révocation est connue **seulement du service Auth**. Si un autre microservice (ex. Orders) vérifie lui-même le JWT avec le secret partagé, il ne voit pas la denylist : le token reste accepté là-bas jusqu'à son expiration (60 min par défaut). Solutions possibles à discuter en groupe : durée de vie courte, ou appel de `GET /api/auth/me` par les autres services pour valider le token.

---

## 8. Sécurité mise en place

- Mots de passe hachés avec **Argon2id** (sel aléatoire inclus), jamais stockés ni renvoyés en clair ; re-hachage automatique si les paramètres changent.
- Même message et même temps de réponse pour « email inconnu » et « mauvais mot de passe » (hash factice) → impossible de deviner quels emails sont inscrits.
- JWT signé HS256, avec `exp`, `iat`, `iss`, `jti` obligatoires ; algorithme imposé (attaque `alg=none` bloquée) ; secret dans `.env`, jamais dans le code.
- Le rôle n'est jamais choisi par le client (`CUSTOMER` imposé à l'inscription).
- Mot de passe limité à 6–128 caractères (128 : évite un déni de service sur Argon2).
- CORS limité aux origines du frontend Vite.
- Contrainte `UNIQUE` sur l'email + gestion de la course entre deux inscriptions simultanées.

Non inclus (hors périmètre du TP, à mentionner) : limitation du nombre de tentatives de connexion, HTTPS, refresh tokens.

---

## 9. Explication de chaque fichier

| Fichier | Rôle, en une phrase | À retenir pour la présentation |
|---|---|---|
| `app/main.py` | Crée l'application FastAPI, active CORS, enregistre les routes et uniformise les erreurs en `{"message"}`. | Au démarrage (`lifespan`) : création des tables + compte démo. Les handlers d'erreurs existent parce que `apiClient.js` lit `error.message`. |
| `app/config.py` | Lit la configuration (`.env` / variables d'environnement) avec des valeurs par défaut. | Aucun secret dans le code ; `CORS_ORIGINS` est une liste séparée par des virgules. |
| `app/database.py` | Ouvre la connexion SQLite et fournit une session par requête (`get_db`). | `check_same_thread=False` car FastAPI utilise plusieurs threads. |
| `app/models.py` | Décrit les tables `users` (identique au `schema.sql` du professeur) et `revoked_tokens`. | `id` en texte (`user-1`, UUID) ; dates au format ISO comme dans le seed. |
| `app/schemas.py` | Définit et valide les JSON d'entrée/sortie avec Pydantic. | `UserOut` ne contient jamais le mot de passe ; un champ `role` envoyé est ignoré. |
| `app/security.py` | Hache/vérifie les mots de passe (Argon2) et crée/vérifie les JWT. | Contenu du token : `sub` (id), `role`, `jti`, `iss`, `iat`, `exp`. |
| `app/dependencies.py` | Contrôle d'accès : lit `Authorization: Bearer`, vérifie le token et la révocation, charge l'utilisateur. | Utilisé par `/me` via `Depends(get_current_user)`. |
| `app/routers/auth.py` | Les 4 endpoints du contrat. | Codes : 201 / 200 / 401 / 409 / 422 ; logout idempotent. |
| `app/seed.py` | Crée `demo@msoa.shop / demo123` avec l'id `user-1`. | `user-1` = même id que le mock React et que la commande de démo dans `orders.db`. |
| `tests/conftest.py` | Prépare une base temporaire et un client HTTP pour les tests. | Chaque test repart d'une base propre. |
| `tests/test_auth.py` | 29 tests couvrant succès, erreurs, sécurité, CORS. | `python -m pytest -v`. |
| `frontend-integration/backend.js` | Le fichier `src/config/backend.js` à utiliser. | Seul `AUTH` passe en `"rest"`. |
| `requirements.txt` | Dépendances avec versions testées. | |
| `.env.example` | Modèle de configuration sans vrai secret. | Copier en `.env`, ne jamais committer `.env`. |
| `pytest.ini` | Configuration de Pytest (dossier des tests, chemin d'import). | |
| `.gitignore` | Exclut `.env`, `*.db`, `.venv`. | |

**Parcours d'une requête de connexion (à raconter à l'oral) :**
`Login.jsx` → `AuthContext.login` → `authService.login` → `POST /api/auth/login` → Pydantic valide `{email, password}` → recherche de l'utilisateur en SQLite → vérification Argon2 → création du JWT → réponse `{user, token}` → le frontend stocke la session dans `localStorage` → les requêtes suivantes envoient `Authorization: Bearer <token>`.

---

## 10. Points de contrat à vérifier avec le professeur / le groupe

Ces points ne sont **pas** précisés par le README ni par le code React. J'ai fait un choix raisonnable, mais il faut le confirmer :

1. **Code HTTP de register** : non spécifié. Choix : `201 Created` + objet user (le frontend accepte tout code 2xx et n'utilise pas la réponse).
2. **Réponse de logout** : non spécifiée. Choix : `200 {"success": true, "message": ...}` (le mock renvoie `{success: true}` ; un `204` serait aussi accepté par `apiClient.js`).
3. **Code des erreurs de validation** : non spécifié. Choix : `422` (convention FastAPI) avec `message`. À confirmer si le professeur attend `400`.
4. **Format des erreurs** : seul `message` est lu par le frontend ; j'ajoute `errors` (détails par champ) uniquement pour les 422.
5. **Format des `id` utilisateurs** : `user-1` pour le démo, UUID pour les nouveaux (comme `crypto.randomUUID()` du mock). Le groupe Orders doit accepter ce format pour `userId`.
6. **Validation du JWT par les autres services** (Orders notamment) : le TP ne dit pas si les autres services doivent vérifier le token. Si oui, il faut se mettre d'accord sur : algorithme `HS256`, **même `JWT_SECRET_KEY`** partagé, `iss = msoa-auth-service`, id utilisateur dans `sub`. Et rappeler la limite de la révocation (§7).
7. **Contrôle « une commande appartient au bon utilisateur »** (critère de validation du README) : c'est Orders qui doit comparer `userId` au `sub` du token — à coordonner avec ce groupe.
8. **Rôle ADMIN** : seul `CUSTOMER` existe dans le dépôt. Aucun endpoint d'administration n'a été inventé.
9. **Durée de validité du token** : non spécifiée. Choix : 60 minutes (configurable). À l'expiration, `/me` renvoie 401 et le frontend déconnecte proprement.
