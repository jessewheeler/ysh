# Content Management

The admin CMS manages three types of public-facing content: announcements, gallery images, and board bios.

## Announcements

Announcements appear as cards on the homepage.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| Title | Yes | Headline displayed on the card |
| Body | Yes | Card content text |
| Image | No | Optional image displayed with the card |
| Link | No | Optional URL — makes the card clickable |
| Sort Order | Yes | Controls display position (lower numbers appear first) |
| Published | Yes | Toggle between published and draft |

### Managing Announcements

1. Navigate to **Announcements** in the sidebar.
2. Click **Add Announcement** to create a new one, or click an existing announcement to edit it.
3. Set **Published** to show the announcement on the homepage, or leave it as draft to hide it.
4. Use **Sort Order** to control the display sequence.
5. To remove an announcement, click **Delete** on its edit page.

## Gallery

Gallery images display event photos on the homepage.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| Image | Yes | Photo file (JPG, PNG, GIF, or WebP; max 5 MB) |
| Alt Text | Yes | Accessibility description of the image |
| Caption | No | Optional text displayed below the image |
| Sort Order | Yes | Controls display position |
| Visible | Yes | Toggle to show or hide the image |

### Managing Gallery Images

1. Navigate to **Gallery** in the sidebar.
2. Click **Add Image** and upload a photo file.
3. Fill in alt text and an optional caption.
4. Use **Sort Order** and **Visible** to control what appears on the site.
5. To remove an image, click **Delete** on its edit page.

### Upload Limits

- Accepted formats: JPG, PNG, GIF, WebP
- Maximum file size: 5 MB

## Board Bios

Board bios appear on the public Bios page, showcasing club leadership.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Board member's full name |
| Role | Yes | Position title (e.g., President, Treasurer) |
| Email | No | Contact address; appears on the [Council membership report](09-council-report.md) |
| Biography | Yes | Short description of the board member |
| Photo | No | Optional headshot |
| Sort Order | Yes | Controls display position |
| Visible | Yes | Toggle to show or hide the bio |

### Managing Board Bios

1. Navigate to **Board Bios** in the sidebar.
2. Click **Add Bio** to create a new profile, or click an existing bio to edit.
3. Upload a photo if available — the same file restrictions as gallery images apply.
4. Use **Sort Order** to arrange bios in the desired sequence.
5. Toggle **Visible** to control whether the bio appears on the public page.

### Roles and the Council report

Every visible bio appears in the board block of the Central Council's membership report,
in sort order, with its **Role** written exactly as saved. Any title works, including ones
the Council never pre-printed. Fill in **Email** for board members; the Council marks that
block mandatory. The block holds ten people, so anyone beyond the tenth visible bio is
left off with a warning. See [Council Membership Report](09-council-report.md).
