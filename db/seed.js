const db = require('./database');
const migrate = require('./migrate');

async function seed() {
  await migrate();

  // Only seed if tables are empty
  const bioCountRes = await db.get('SELECT COUNT(*) as c FROM bios');
  const bioCount = bioCountRes ? bioCountRes.c : 0;
  if (bioCount > 0) {
    console.log('Database already seeded, skipping.');
    return;
  }

  console.log('Seeding database...');

  // --- Bios ---
  const bios = [
    {
      name: 'John Fanzone',
      role: 'President',
      bio_text: `I was born in Michigan but grew up in Washington State from the age of 5 and have loved watching the Seahawks for as long as I can remember. I graduated from Bellevue College and during that time I met my wife who was born and raised in Red Lodge, MT and was out there for school. After our first child was born, we packed everything up and moved to Montana which was in 2009. My wife and I and now 2 kids and live in Billings, MT where I am currently a sales rep for wholesale distributor. I am an avid hunter and love the outdoors so Montana grew on me very quickly but I never lost my love and passion for the Hawks! I was introduced to the Seahawkers club a few years ago and love the openness and the welcoming they had to celebrate with fellow Seahawk fans even though we are not in Seattle. It's that and their passion to make a difference in their local communities that made me want to be a part of it. In my free time I volunteer at my local church, coach the many different sports my kids play and hang out with friends. My favorite time of year is the fall as Montana doesn't get any prettier but it's also football and hunting season. I am super excited to be a part of this board and look forward to all the impacts we can have not only here in Montana but in each and every location we are planted. GO HAWKS!!`,
      photo_path: '/img/bios/john_fanzone.jpg',
      sort_order: 1,
    },
    {
      name: 'Peter Davies',
      role: 'Vice-President',
      bio_text: `I was Born and raised a farm boy watching the Seahawks in Eastern Washington State. A graduate of Washington State University who spent 25 years in Broadcast Television, where I had the pleasure to be on the field for the very last Seahawks game before the King Dome was imploded. I graduated in '99 and started a very storied adventure and career that began in Alaska and ended up in Billings Montana. Everywhere I've lived and visited I find Seahawks fans and the 12 Flag a-flying. These days my Gypsy sole has settled down some, I've left television for a quieter life of camping, hiking and enjoying the outdoors with my two dogs. I spend game days with fellow Sea Hawks fans rooting for our home team. Even though I've left television my involvement with technology continues. Currently I'm a Network Engineer for a rural ISP and involved with several technology groups around the Billings area. I'm super excited to be part of this board and new chapter. This is going to be an awesome adventure and we are going to make a huge impact in our area! Go Hawks!!!`,
      photo_path: '/img/bios/peter_davies.jpg',
      sort_order: 2,
    },
    {
      name: 'Kate McLean',
      role: 'Treasurer',
      bio_text: `Born in Western Washington and raised a 12 in Montana, I bleed blue and green! I enjoy giving back to my community and helping out where it is needed. I take #12sForGood seriously! I live in Billings with my husband and dogs. I enjoy rafting, camping, hiking and getting LOUD with my fellow Billings-area Seahawkers on Sundays (and sometimes Thursday or Monday nights or Fridays and Saturdays during the playoffs). Football is Family. GO HAWKS!`,
      photo_path: '/img/bios/kate_mclean.jpg',
      sort_order: 3,
    },
    {
      name: 'Tricia Old Elk',
      role: 'Secretary',
      bio_text: `Hello fellow Sea Hawkers!! My name is Tricia Old Elk and I'm Crow/Sioux. Born in Crow Agency Montana and raised a military brat, my parents ended up getting stationed at McChord AFB and retired there. I have my Masters in Social Work and an alumni from the University of Washington. I specialized in mental health and homelessness. I've recently found my true passion, which is cooking. So now I work as a Chef in Ft. Smith at the Big Horn County Ranch. I also volunteer at the Babcock and Art House Cinema, as I love independent film. One of the non-profits I support is Food for the Soul which operates in Billings every Friday providing a meal to hungry folks. I love the Seahawks and bleed green and blue. I feel very fortunate to serve the Yellowstone Sea Hawkers as your secretary. I can't wait for this season to start and most importantly, Go HAWKS!!!!`,
      photo_path: '/img/bios/tricia_old_elk.jpg',
      sort_order: 4,
    },
    {
      name: 'D Becker',
      role: 'Central Council Rep',
      bio_text: `I'm a long-time football fan, and a Seahawk fan from before the first draft. In fact, I attended that first draft, where I ran into Jack Patera -- literally. I carried the bruises for a week, and to this day am very careful about walking around blind corners! I originally joined the Sea Hawkers about 1978 when we lived in north Seattle. There were monthly dinner meetings, with speakers. One time, the then-coach was supposed to speak, but he had a family emergency. He sent a substitute, a fellow named Jim Zorn. My family moved to Portland about 1985, and I had to drop out of Sea Hawkers, as no clubs were sanctioned outside of the Puget Sound area. In the 90's, Roger Peterson and I started sharing season tickets, which he had in his name. We would drive to Seattle on Sunday, then home again to be at work on Monday. Both of our spouses were happy that we attended the games together, because they didn't appreciate all our cheering at home! When the Hawks moved to what was then Seahawks Stadium in 2002, I got a four-game ticket package and then got additional games throughout that first season in the new location. I moved all around the stadium, sitting in different places to see what the different areas had to offer. The next year I got my first season package in my own name. I moved to Centralia, Washington in 2008, in part to be closer to the games. Since retiring in 2012, I've had more time to take part in Sea Hawkers. While spending over a month fighting wildfires in Montana in 2017, I started working with Roger and several other avid Seahawks fans to form what was originally the Montana Sea Hawkers. Although I still live in western Washington, I am proud to represent Yellowstone at the Central Council. Sea Hawkers has changed a lot since they first were formed. Instead of being a local fan club, we have become an international community, working to help those who could use our help while cheering on the best team in the NFL.`,
      photo_path: '/img/bios/d-becker.jpg',
      sort_order: 5,
    },
    {
      name: 'Jesse Wheeler',
      role: 'Director of PR/Entertainment',
      bio_text: `Born and raised in Washington, I've been a Seahawks fan for as long as I can remember. I now live in Billings with my wife and our three kids, where we're raising the next generation of 12s. By day, I work as a software architect, but my real passion comes out on Sundays when cheering on the Hawks. It's great to be with fellow fans who bring the energy no matter how far we are from Lumen Field. I'm a big believer in the power of community, and I'm excited to help grow the Yellowstone Sea Hawkers through storytelling, digital outreach, and social media. Whether it's promoting events or capturing the spirit of game day, I'm here to help amplify our chapter. Go Hawks!`,
      photo_path: '/img/bios/jesse-wheeler.png',
      sort_order: 6,
    },
    {
      name: 'Brenda Rosler Hanson',
      role: 'Central Council Rep',
      bio_text: `Hello I am Brenda Rosler Hanson, 4th generation Montana girl. Been a Seahawks fan since day one, 1976. I became a super fan when my son was 10. We went to fanfest one summer in 2003 and took my son and he was so terrified by such huge players he literally froze in line collecting autographs and one of the players said "it's alright little man. We are big guys with big hearts." Since then I became one of the founding board members of Seahawkers for Montana in 2016 and dedicated my life to being a 12s4good. In 2022 I had the honor of winning Seahawker of the year. I spend my time doing charity work in our community from meals on wheels to Mikayla's miracles and heart locker and also help with the shelters.`,
      photo_path: '/img/bios/Brenda-hanson.jpg',
      sort_order: 7,
    },
  ];
  for (const b of bios) {
    await db.run(
      'INSERT INTO bios (name, role, bio_text, photo_path, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, 1)',
      b.name, b.role, b.bio_text, b.photo_path, b.sort_order
    );
  }

  // --- Announcements ---
  await db.run(
    'INSERT INTO announcements (title, body, image_path, link_url, link_text, is_published, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)',
    'YSH Turns Watch Party into a Fundraiser',
    'KTVQ In Billings reports on the Yellowstone Sea Hawkers watch party that was turned into a fundraiser for Family Services of Billings.',
    '/assets/fundr.jpg',
    'https://youtu.be/0S-kCaPTRlo',
    'Watch Video',
    1
  );
  await db.run(
    'INSERT INTO announcements (title, body, image_path, link_url, link_text, is_published, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)',
    'Dog Tag Buddies',
    'YSH is proud to announce that we are supporting Dog Tag Buddies for the 25-26 season. We invite you to visit their organization, learn about this wonderful organization and donate to an excellent cause.',
    '/assets/logo.png',
    'https://www.dogtagbuddies.org',
    'Learn More',
    2
  );

  // --- Gallery images ---
  await db.run('INSERT INTO gallery_images (filename, alt_text, sort_order, is_visible) VALUES (?, ?, ?, 1)', '/img/ysh_gallery.jpg', 'Gallery photo 1', 1);
  await db.run('INSERT INTO gallery_images (filename, alt_text, sort_order, is_visible) VALUES (?, ?, ?, 1)', '/img/ysh_gallery2.jpg', 'Gallery photo 2', 2);
  await db.run('INSERT INTO gallery_images (filename, alt_text, sort_order, is_visible) VALUES (?, ?, ?, 1)', '/img/ysh_gallery3.jpg', 'Gallery photo 3', 3);
  await db.run('INSERT INTO gallery_images (filename, alt_text, sort_order, is_visible) VALUES (?, ?, ?, 1)', '/img/ysh_gallery4.jpg', 'Gallery photo 4', 4);

  // --- Site settings ---
  const settings = {
    hero_title: 'Yellowstone Sea Hawkers',
    hero_subtitle: 'Join your fellow Seahawks fans at the Red Door Lounge in Billings for our watch party! Enjoy the game day specials on food and drink, and lots of fun!',
    hero_button_text: 'Red Door Lounge — 3875 Grand Ave, Billings, MT',
    hero_button_url: 'https://maps.app.goo.gl/rSenva2n2pinhLRL7',
    about_quote: "Yellowstone Sea Hawkers are the most passionate, hardcore, devoted, cheer-crazy, raisin' the roof, no-life-during-football-season-havin' fans on earth.",
    about_text: 'Our primary purpose is to have fun while supporting the Seahawks football team, their coaches, staff, our local charities, and organizations in the city of Billings and its surrounding communities.',
    gallery_album_url: 'https://1drv.ms/a/c/10fffe404656475d/EqrBFR6ebKtMhwnrQj-bm6wBRoAUuX5GI4Rp3EdNVW5kIw?e=l1rltU',
    individual_dues_amount_cents: '1600',
    family_dues_amount_cents: '2600',
    max_family_members: '6',
    contact_email: 'info@yellowstoneseahawkers.com',
    stripe_publishable_key: '',
  };
  for (const [k, v] of Object.entries(settings)) {
    await db.run('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)', k, v);
  }

  console.log('Seed complete.');
}

module.exports = seed;

if (require.main === module) {
  seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
