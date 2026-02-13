# db/ -- Database

SQLite database layer using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). All database files are stored in the `data/` directory at the project root (gitignored).

## Files

| File          | Purpose                                                                                                                                                                                                                 |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `database.js` | Singleton database connection. Configures WAL journal mode and enables foreign keys. Every other module that needs the DB imports this file.                                                                            |
| `migrate.js`  | Creates all 8 tables with `CREATE TABLE IF NOT EXISTS`. Safe to run repeatedly. Can be run standalone with `npm run migrate`.                                                                                           |
| `seed.js`     | Runs migrations first, then populates empty tables with the original hardcoded site content (7 board bios, 2 announcements, 4 gallery images, 10 site settings). Skips if data already exists. Run with `npm run seed`. |

## Schema

### members
| Column          | Type    | Notes                                          |
|-----------------|---------|------------------------------------------------|
| id              | INTEGER | Primary key, autoincrement                     |
| member_number   | TEXT    | Unique, format `YSH-2026-0001`                 |
| first_name      | TEXT    | Required                                       |
| last_name       | TEXT    | Required                                       |
| email           | TEXT    | Unique, required                               |
| phone           | TEXT    |                                                |
| address_street  | TEXT    |                                                |
| address_city    | TEXT    |                                                |
| address_state   | TEXT    |                                                |
| address_zip     | TEXT    |                                                |
| membership_year | INTEGER |                                                |
| status          | TEXT    | `pending`, `active`, `expired`, or `cancelled` |
| notes           | TEXT    |                                                |
| created_at      | TEXT    | ISO datetime, auto-set                         |
| updated_at      | TEXT    | ISO datetime, auto-set                         |

### payments
| Column                | Type    | Notes                                           |
|-----------------------|---------|-------------------------------------------------|
| id                    | INTEGER | Primary key                                     |
| member_id             | INTEGER | FK to `members.id`, cascades on delete          |
| stripe_session_id     | TEXT    | Stripe Checkout Session ID                      |
| stripe_payment_intent | TEXT    | Stripe PaymentIntent ID                         |
| amount_cents          | INTEGER | Required                                        |
| currency              | TEXT    | Default `usd`                                   |
| status                | TEXT    | `pending`, `completed`, `failed`, or `refunded` |
| description           | TEXT    |                                                 |
| created_at            | TEXT    |                                                 |
| updated_at            | TEXT    |                                                 |

### announcements
| Column       | Type    | Notes                                       |
|--------------|---------|---------------------------------------------|
| id           | INTEGER | Primary key                                 |
| title        | TEXT    | Required                                    |
| body         | TEXT    |                                             |
| image_path   | TEXT    | Path relative to public root or `/uploads/` |
| link_url     | TEXT    |                                             |
| link_text    | TEXT    |                                             |
| is_published | INTEGER | 0 or 1                                      |
| sort_order   | INTEGER | Lower = first                               |
| created_at   | TEXT    |                                             |
| updated_at   | TEXT    |                                             |

### gallery_images
| Column     | Type    | Notes                        |
|------------|---------|------------------------------|
| id         | INTEGER | Primary key                  |
| filename   | TEXT    | Required. Path to image file |
| alt_text   | TEXT    |                              |
| caption    | TEXT    |                              |
| sort_order | INTEGER |                              |
| is_visible | INTEGER | 0 or 1                       |
| created_at | TEXT    |                              |

### bios
| Column     | Type    | Notes                         |
|------------|---------|-------------------------------|
| id         | INTEGER | Primary key                   |
| name       | TEXT    | Required                      |
| role       | TEXT    | e.g. "President", "Treasurer" |
| bio_text   | TEXT    | Full biography                |
| photo_path | TEXT    | Path to photo                 |
| sort_order | INTEGER |                               |
| is_visible | INTEGER | 0 or 1                        |
| created_at | TEXT    |                               |
| updated_at | TEXT    |                               |

### site_settings
| Column     | Type | Notes       |
|------------|------|-------------|
| key        | TEXT | Primary key |
| value      | TEXT |             |
| updated_at | TEXT |             |

Seeded keys: `hero_title`, `hero_subtitle`, `hero_button_text`, `hero_button_url`, `about_quote`, `about_text`, `gallery_album_url`, `dues_amount_cents`, `contact_email`, `stripe_publishable_key`.

### emails_log
| Column     | Type    | Notes                                                                     |
|------------|---------|---------------------------------------------------------------------------|
| id         | INTEGER | Primary key                                                               |
| to_email   | TEXT    | Required                                                                  |
| to_name    | TEXT    |                                                                           |
| subject    | TEXT    |                                                                           |
| body_html  | TEXT    |                                                                           |
| email_type | TEXT    | `welcome`, `payment_confirmation`, `card_delivery`, `blast`, or `contact` |
| status     | TEXT    | `sent` or `failed`                                                        |
| error      | TEXT    | Error message if failed                                                   |
| member_id  | INTEGER | FK to `members.id`, nullable, sets null on delete                         |
| created_at | TEXT    |                                                                           |

### membership_cards
| Column     | Type    | Notes                                  |
|------------|---------|----------------------------------------|
| id         | INTEGER | Primary key                            |
| member_id  | INTEGER | FK to `members.id`, cascades on delete |
| pdf_path   | TEXT    | Relative path to PDF file              |
| png_path   | TEXT    | Relative path to PNG file              |
| year       | INTEGER | Membership year                        |
| created_at | TEXT    |                                        |

## Runtime Files

The `data/` directory (gitignored) contains:
- `ysh.db` -- the SQLite database
- `sessions.db` -- the session store (managed by connect-sqlite3)
- `cards/` -- generated membership card files (PDF + PNG)
