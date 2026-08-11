import sqlite3
import os


class DatabaseManager:
    """Manages the SQLite test database for Robot Framework E2E tests."""

    ROBOT_LIBRARY_SCOPE = 'SUITE'

    ADMIN_EMAIL = 'admin@test.example.com'
    ADMIN_NAME = 'Test Admin'
    OTP_CODE = '000000'

    def __init__(self, project_root):
        self.project_root = project_root
        self.db_path = os.path.join(project_root, 'data', 'ysh-robot.db')
        self.conn = None

    def connect_to_database(self):
        """Open a connection to the test database."""
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.execute('PRAGMA foreign_keys=ON')

    def close_database(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None

    def reset_database(self):
        """Delete all rows in FK-safe order and re-seed minimal data."""
        tables = [
            'membership_cards',
            'emails_log',
            'membership_years',
            'payments',
            'campaign_visits',
            'contact_submissions',
            'members',
            'campaigns',
            'membership_periods',
            'announcements',
            'gallery_images',
            'bios',
            'site_settings',
        ]
        for table in tables:
            self.conn.execute(f'DELETE FROM {table}')
        self.conn.commit()
        self.seed_settings()
        self.seed_admin()
        self.seed_period()

    def seed_settings(self):
        """Insert default site_settings."""
        settings = {
            'hero_title': 'Yellowstone Sea Hawkers',
            'hero_subtitle': 'Join your fellow Seahawks fans at the Red Door Lounge in Billings for our watch party! Enjoy the game day specials on food and drink, and lots of fun!',
            'hero_button_text': 'Red Door Lounge \u2014 3875 Grand Ave, Billings, MT',
            'hero_button_url': 'https://maps.app.goo.gl/rSenva2n2pinhLRL7',
            'about_quote': "Yellowstone Sea Hawkers are the most passionate, hardcore, devoted, cheer-crazy, raisin' the roof, no-life-during-football-season-havin' fans on earth.",
            'about_text': 'Our primary purpose is to have fun while supporting the Seahawks football team, their coaches, staff, our local charities, and organizations in the city of Billings and its surrounding communities.',
            'gallery_album_url': 'https://1drv.ms/a/c/10fffe404656475d/EqrBFR6ebKtMhwnrQj-bm6wBRoAUuX5GI4Rp3EdNVW5kIw?e=l1rltU',
            'dues_amount_cents': '2500',
            'contact_email': 'info@yellowstoneseahawkers.com',
            'stripe_publishable_key': '',
        }
        for key, value in settings.items():
            self.conn.execute(
                "INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
                (key, value),
            )
        self.conn.commit()

    def seed_period(self, label='Robot Test Season'):
        """Insert a membership period that is current (spans today)."""
        cursor = self.conn.execute(
            """INSERT INTO membership_periods
               (label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents)
               VALUES (?, date('now', '-30 days'), date('now', '+300 days'), 1600, 2600, 0)""",
            (label,),
        )
        self.conn.commit()
        return cursor.lastrowid

    def seed_campaign(self, name='Robot Campaign', utm_campaign='robot26',
                      utm_source='print', utm_medium='flyer', target_path='/membership',
                      is_active=1):
        """Insert a campaign and return its row ID."""
        cursor = self.conn.execute(
            """INSERT INTO campaigns (name, utm_campaign, utm_source, utm_medium, target_path, is_active)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, utm_campaign, utm_source, utm_medium, target_path, int(is_active)),
        )
        self.conn.commit()
        return cursor.lastrowid

    def count_campaign_visits(self, campaign_id):
        """Return how many visits are recorded against a campaign."""
        row = self.conn.execute(
            'SELECT COUNT(*) AS c FROM campaign_visits WHERE campaign_id = ?', (campaign_id,)
        ).fetchone()
        return row['c']

    def count_contact_submissions(self, campaign_id=None):
        """Return the contact submission count, optionally for one campaign."""
        if campaign_id is None:
            row = self.conn.execute('SELECT COUNT(*) AS c FROM contact_submissions').fetchone()
        else:
            row = self.conn.execute(
                'SELECT COUNT(*) AS c FROM contact_submissions WHERE campaign_id = ?', (campaign_id,)
            ).fetchone()
        return row['c']

    def get_member_campaign_id(self, email):
        """Return the campaign_id attributed to a member, or None."""
        row = self.conn.execute(
            'SELECT campaign_id FROM members WHERE email = ? ORDER BY id LIMIT 1', (email,)
        ).fetchone()
        return row['campaign_id'] if row else None

    def seed_admin(self, email=None, first_name=None, last_name=None, role='super_admin'):
        """Insert a test admin into members and return the row ID."""
        email = email or self.ADMIN_EMAIL
        first_name = first_name or 'Test'
        last_name = last_name or 'Admin'
        cursor = self.conn.execute(
            'INSERT INTO members (first_name, last_name, email, role) VALUES (?, ?, ?, ?)',
            (first_name, last_name, email, role),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_admin_email(self):
        """Return the default test admin email."""
        return self.ADMIN_EMAIL

    def get_otp_code(self):
        """Return the known OTP code for test logins."""
        return self.OTP_CODE

    def seed_announcements(self, count=1):
        """Insert `count` published announcements."""
        for i in range(1, int(count) + 1):
            self.conn.execute(
                'INSERT INTO announcements (title, body, is_published, sort_order) VALUES (?, ?, 1, ?)',
                (f'Test Announcement {i}', f'Body of test announcement {i}', i),
            )
        self.conn.commit()

    def seed_bios(self, count=1):
        """Insert `count` visible bios."""
        for i in range(1, int(count) + 1):
            self.conn.execute(
                'INSERT INTO bios (name, role, bio_text, sort_order, is_visible) VALUES (?, ?, ?, ?, 1)',
                (f'Test Person {i}', f'Role {i}', f'Bio text for person {i}', i),
            )
        self.conn.commit()

    def seed_bio(self, name='Test Person', role=None, email=None, sort_order=1,
                 bio_text=None, is_visible=1):
        """Insert one bio with an explicit role and email and return the row ID.

        The Council membership report reads its board block from bios whose role is one
        of the six Council titles, so those tests need control over role and email.
        """
        cursor = self.conn.execute(
            'INSERT INTO bios (name, role, email, bio_text, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?)',
            (name, role, email, bio_text or f'Bio text for {name}', sort_order, int(is_visible)),
        )
        self.conn.commit()
        return cursor.lastrowid

    def enroll_member(self, member_id, period_id):
        """Enroll a member in a membership period and return the junction row ID."""
        cursor = self.conn.execute(
            'INSERT OR IGNORE INTO membership_years (member_id, membership_period_id) VALUES (?, ?)',
            (int(member_id), int(period_id)),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_current_period_id(self):
        """Return the ID of the period spanning today with the latest start date."""
        row = self.conn.execute(
            """SELECT id FROM membership_periods
               WHERE date('now') BETWEEN start_date AND end_date
               ORDER BY start_date DESC LIMIT 1"""
        ).fetchone()
        return row[0] if row else None

    def seed_gallery(self, count=1):
        """Insert `count` visible gallery images."""
        for i in range(1, int(count) + 1):
            self.conn.execute(
                'INSERT INTO gallery_images (filename, alt_text, sort_order, is_visible) VALUES (?, ?, ?, 1)',
                (f'/img/test_gallery_{i}.jpg', f'Test gallery {i}', i),
            )
        self.conn.commit()

    def seed_member(self, first_name='Test', last_name='Member', email=None,
                    phone=None, status='active', membership_year=2026,
                    member_number=None, address_street=None, address_city=None,
                    address_state='MT', address_zip=None, notes=None):
        """Insert a member and return the row ID."""
        if email is None:
            import random
            email = f'test{random.randint(10000, 99999)}@example.com'
        if member_number is None:
            count = self.conn.execute('SELECT COUNT(*) FROM members').fetchone()[0]
            member_number = f'YSH-{membership_year}-{str(count + 1).zfill(4)}'
        cursor = self.conn.execute(
            '''INSERT INTO members
               (member_number, first_name, last_name, email, phone,
                address_street, address_city, address_state, address_zip,
                membership_year, status, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (member_number, first_name, last_name, email, phone,
             address_street, address_city, address_state, address_zip,
             membership_year, status, notes),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_row_count(self, table):
        """Return COUNT(*) from the given table."""
        row = self.conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()
        return row[0]

    def query_sql(self, sql):
        """Run an arbitrary SELECT and return a list of dicts."""
        cursor = self.conn.execute(sql)
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
