"""Author spec.json for books 6-9 (book 10 is written after the others exist). Run once: python3 common/make_specs.py"""
import os, json, shutil
ROOT = "/home/user/github.io/docs/kdp-picture-book"
Q = lambda s: s.replace("'", "’")
def u_pair(l, r):
    """Curly quotes for one spread; the double-quote state continues from the left page to the right page."""
    state = {"open": True}
    def conv(t):
        out = []
        for i, ch in enumerate(t):
            prev = t[i - 1] if i else " "
            if ch == '"':
                out.append("\u201c" if state["open"] else "\u201d"); state["open"] = not state["open"]
            elif ch == "'":
                out.append("\u2018" if prev in " \u201c" else "\u2019")
            else:
                out.append(ch)
        return "".join(out)
    return conv(l), conv(r)
def u(s):
    return u_pair(s, "")[0]

STYLE = ("Style: soft watercolor and gouache children's picture book, warm cozy palette, subtle paper texture. ")
SPREAD = ("Wide 2:1 panoramic spread. The picture will be folded in the exact middle (a book gutter), so NOTHING important may sit in the central 15% vertical strip: all characters, faces, and key objects must be fully inside either the LEFT half or the RIGHT half, as specified. Leave a calm low-detail area along the top for text. Request the largest output size the tool supports. ")
def common(extra_refs, setting, metaphor):
    return ("Use your built-in image generation tool to create ONE picture-book illustration. Use the attached images as references: character-sheet.png for the bear Fennel (round brown cub, cream muzzle, mustard-yellow sweater and red scarf by day; keep his face and proportions IDENTICAL), mama-ref.png for Mama Bear (larger, same brown fur and cream muzzle, lavender cardigan and floral skirt, kind face) and for the painting style" + extra_refs + ". "
            + STYLE + setting + " " + metaphor + " No text, letters or words anywhere in the image (no signs, labels or writing on anything). ")

BOOKS = {}

# ---------------- Book 6: Peach Shy ----------------
BOOKS[6] = dict(
 folder="book6-fennel-peach-shy", title="Fennel and the Big Peach Shy", title_lines=["Fennel and","the Big Peach Shy"],
 subtitle="A story about feeling shy", subtitle_listing="A Story About Feeling Shy",
 story=[
  ["Clover the bunny turned five today,","and Fennel was invited to come and play!"],
  ["He wrapped up a gift in a bow of blue.","\"A party!\" said Mama. \"I'll go with you.\""],
  ["Balloons! And music! And cake on a plate!","So many faces! Fennel stopped at the gate."],
  ["A fuzzy peach cloud floated down, soft and slow.","It wrapped around Fennel from head to toe."],
  ["His voice went tiny. His cheeks felt hot.","He hid behind Mama and stayed on the spot."],
  ["Mama knelt down. \"Shy is okay.","Lots of us feel shy, every day.\""],
  ["\"First, WAVE. Just lift your paw up high.","A wave is a way to say a shy hi.\""],
  ["\"Next, SAY one small hello.","'Hi, I'm Fennel.' Say it soft and slow.\""],
  ["\"Last, SHARE. Have something to give.","A toy or a snack helps a friendship live.\""],
  ["Fennel waved a wave, and it wasn't so bad.","\"Hi, I'm Fennel,\" he said, feeling glad."],
  ["He shared his gift. Clover jumped with glee.","\"Come play with me!\" she said. \"Come play with me!\""],
  ["The peach cloud floated off like a feather.","Wave. Say. Share. Make friends together."],
 ],
 steps_title="Fennel's 3 Friendly Steps",
 steps=[["1. WAVE","Lift a paw and wave hello."],["2. SAY","Say one small hello."],["3. SHARE","Share a toy or a snack."]],
 steps_closing=["Shy is okay.","Friends are waiting."],
 note_lines=["Name the feeling: \"You feel shy.\"","Do not push. Stay close until your child is ready.","Practice a wave and a hello at home.","Praise every small try."],
 cover_blurb=["Clover's birthday party is today.","But a fuzzy Big Peach Shy wraps around Fennel.","","With a little help from Mama Bear,","Fennel learns three friendly steps","to say hello:","Wave. Say. Share.","","A warm rhyming story for ages 3–6,","with a note for grown-ups."],
 listing=dict(
  description="""<p><b>Clover's birthday party is today! But when Fennel gets to the gate, a fuzzy Big Peach Shy floats down and wraps around him.</b></p>
<p>So many faces! So much noise! His voice goes tiny and his cheeks feel hot, until Mama Bear kneels beside him and shows him how to say hello.</p>
<p>With three friendly steps — <b>Wave. Say. Share.</b> — little readers learn that shy is okay, and that friends are waiting.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A cozy read-aloud rhyme for ages 3–6, great before a birthday party or playdate</li>
<li>A kid-friendly image of shyness as a soft peach cloud that floats away</li>
<li>Three easy steps children can copy: Wave, Say, Share</li>
<li>A note for grown-ups with simple ways to support a shy child</li>
<li>Soft watercolor-style illustrations</li>
</ul>
<p>Book 6 in the Fennel's Feelings series. A gentle story for any child who feels shy meeting new friends.</p>""",
  keywords=["children's book about shyness","shy child picture book ages 3-6","book about making friends for kids","birthday party book for shy kids","social emotional learning book preschool","rhyming picture book bear friendship","help shy toddler say hello"],
  categories=["Children's Books › Growing Up & Facts of Life › Emotions & Feelings","Children's Books › Growing Up & Facts of Life › Friendship","Children's Books › Literature & Fiction › Animals › Bears"],
  notes="- No book titled \"Fennel and the Big Peach Shy\" or \"Big Peach Shy\" found.\n- Closest: *Sammy Feels Shy* (Tom Percival, Big Bright Feelings; shy = turning pink), *Shy* (Deborah Freedman), *Bartleby* (Matt Phelan). Peach was chosen to stay away from pink. Check the exact title on Amazon before publishing."),
 gen=dict(
  refs=["character-sheet.png","mama-ref.png","clover-ref.png"],
  common=common(" and clover-ref.png for Clover, a small cream-colored bunny in blue overalls (keep her identical)", "The setting is Fennel's cozy cottage and a sunny garden birthday party with a gate, balloons and a cake table.", "The 'shyness' is a soft, fuzzy, peach-colored cloud-blanket, like a cozy peach wool cloud that wraps around Fennel and muffles him (never a monster, no face)."),
  spread=SPREAD,
  scenes={
   "s01":"Fennel holding a colorful birthday invitation card (drawn with balloons and a cake, no writing) with Mama Bear smiling beside him, both fully in the RIGHT half (Fennel about 62% of width, Mama about 84%); LEFT half: sunny living room window and a small table with a wrapped gift.",
   "s02":"Fennel carefully wrapping a gift box in blue paper with a big blue bow at a kitchen table, Mama Bear helping, both fully in the LEFT half (Fennel about 18%, Mama about 38%); RIGHT half: a sunny kitchen window with flowers.",
   "s03":"Fennel and Mama Bear arriving at a garden gate decorated with balloons, Fennel holding the blue-bowed gift, both fully in the LEFT half (Fennel about 20%, Mama about 38%); a lively party in the RIGHT half (55% to 95%): Clover the bunny, a duckling, a squirrel, a hedgehog and a mouse playing near a cake table with balloons.",
   "s04":"Fennel at the party gate fully in the LEFT half (about 27%), looking up in surprise as a big fuzzy peach-colored cloud-blanket floats down and begins to wrap around him; the party is small and far away in the RIGHT half.",
   "s05":"Fennel wrapped in the peach cloud peeking out from behind Mama Bear's floral skirt, cheeks warm, both fully in the RIGHT half (Fennel about 62%, Mama about 84%); LEFT half: the party scene softly blurred in the distance.",
   "s06":"Mama Bear kneeling to Fennel's eye level with a gentle hand on his shoulder, the peach cloud around Fennel, both fully in the LEFT half (Fennel about 18%, Mama about 38%); RIGHT half: the party garden with a tent and balloons.",
   "s07":"Mama Bear and Fennel standing together; Fennel lifting one paw high to practice a wave, Mama waving too, the peach cloud a little smaller, both fully in the RIGHT half (Fennel about 62%, Mama about 84%); LEFT half: garden path with flowers.",
   "s08":"Fennel practicing saying hello: a small friendly speech bubble above him containing only a tiny drawing of a waving paw (no writing); Mama Bear smiling beside him, both fully in the LEFT half (Fennel about 18%, Mama about 38%); the peach cloud thinner; RIGHT half: garden with the party far away.",
   "s09":"Mama Bear showing Fennel the blue-bowed gift box and a small basket of cupcakes to share; Fennel holds the gift; both fully in the RIGHT half (Fennel about 62%, Mama about 84%); the peach cloud smaller; LEFT half: garden path.",
   "s10":"Fennel fully in the LEFT half (about 27%), smiling bravely and waving one paw, a small peach cloud above him; Clover the bunny in blue overalls fully in the RIGHT half (about 72%) near the cake table, looking toward him happily.",
   "s11":"Fennel handing the blue-bowed gift to Clover the bunny, who jumps with joy, both fully in the RIGHT half (Fennel about 62%, Clover about 84%), a few party animals cheering; LEFT half: the party table with cake and balloons.",
   "s12":"Fennel, Clover and two other friends (a duckling and a squirrel) playing happily with a ball in the garden, all fully in the RIGHT half; in the sky at the top of the LEFT half, a small peach cloud floats away like a feather; LEFT half: the sunny garden with balloons.",
   "cover":"SQUARE 1:1 front cover art. IMPORTANT LAYOUT: the top 38% of the image must be calm empty soft-blue sky (no balloons, no tree tops) because a large title will be printed there. Scene in the lower 62%: Fennel peeking out from behind a garden gate or a tree, holding a blue-bowed gift, wrapped in a big fuzzy peach-colored cloud-blanket, looking shyly toward a party with balloons in the background. Fennel is the largest figure.",
  }))

# ---------------- Book 7: Yellow Excited ----------------
BOOKS[7] = dict(
 folder="book7-fennel-yellow-excited", title="Fennel and the Big Yellow Excited", title_lines=["Fennel and","the Big Yellow Excited"],
 subtitle="A story about feeling excited", subtitle_listing="A Story About Feeling Excited",
 story=[
  ["Tomorrow was the Fair! Hooray, hooray!","Fennel could not wait for the big, big day!"],
  ["He counted his coins. He brushed his hair.","He was so excited he danced on the stair!"],
  ["At bedtime, a yellow spark went POP!","It bounced on his pillow, hop, hop, hop!"],
  ["More sparks came bouncing round and round,","bouncing off the walls with a boing-y sound."],
  ["The Big Yellow Excited filled the room.","Fennel bounced on the bed. Zoom, zoom, ZOOM!"],
  ["His toys went flying. His pillow too.","\"I can't lie down!\" he said. \"What do I do?\""],
  ["Papa Bear came and sat on the bed.","\"Excited is big,\" the kind bear said."],
  ["\"First, WIGGLE it out! Shake your paws, shake your knees!\"","Fennel wiggled and giggled and shook like the breeze."],
  ["\"Next, BREATHE. Puff your tummy up big and round,","then let the air out with a soft, whooshy sound.\""],
  ["\"Last, WAIT. Make a countdown. Cross off the night.","Tomorrow is coming. Tonight, hold on tight.\""],
  ["The sparks bounced slower, and slower, then slept.","Fennel cuddled in close, and a sweet dream crept."],
  ["Next day at the Fair, with its lights shining bright,","Fennel wiggled and breathed and he waited just right."],
 ],
 steps_title="Fennel's 3 Calm Steps",
 steps=[["1. WIGGLE","Shake it out! Wiggle and jump."],["2. BREATHE","Puff your tummy up, then let it out."],["3. WAIT","Make a countdown. Waiting can be fun."]],
 steps_closing=["Excited is okay.","Big days are worth the wait."],
 note_lines=["Name the feeling: \"You feel excited.\"","Let your child move first, then breathe together.","Make a simple countdown with stickers or stars.","Praise the waiting, not just the event."],
 cover_blurb=["Tomorrow is the Fair!","But a bouncy Big Yellow Excited","will not let Fennel sleep.","","With a little help from Papa Bear,","Fennel learns three calm steps","to settle his sparks:","Wiggle. Breathe. Wait.","","A warm rhyming story for ages 3–6,","with a note for grown-ups."],
 listing=dict(
  description="""<p><b>Tomorrow is the Fair! Hooray, hooray! But at bedtime, a yellow spark goes POP... and then another... and another.</b></p>
<p>The Big Yellow Excited bounces on the pillow, off the walls, and all over Fennel's bed, until Papa Bear sits beside him and shows him how to settle his sparks.</p>
<p>With three calm steps — <b>Wiggle. Breathe. Wait.</b> — little readers learn that excited is a good feeling that can feel very big, and that waiting can be fun.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A bouncy read-aloud rhyme for ages 3–6, perfect for the night before a big day</li>
<li>A kid-friendly image of excitement as bouncy yellow sparks that slow down and sleep</li>
<li>Three easy steps children can copy: Wiggle, Breathe, Wait</li>
<li>A note for grown-ups with simple ways to help an over-excited child</li>
<li>Soft watercolor-style illustrations</li>
</ul>
<p>Book 7 in the Fennel's Feelings series. Great for bedtime, birthdays, holidays, and trips.</p>""",
  keywords=["children's book about excitement and waiting","too excited to sleep book for kids","bedtime book for excited toddlers","patience book for preschoolers","social emotional learning book ages 3-6","rhyming picture book bear family","night before a big day book"],
  categories=["Children's Books › Growing Up & Facts of Life › Emotions & Feelings","Children's Books › Literature & Fiction › Animals › Bears","Children's Books › Growing Up & Facts of Life › Family Life"],
  notes="- No book titled \"Fennel and the Big Yellow Excited\" or \"Big Yellow Excited\" found.\n- Closest: *The Yellow Book: What to Do When You're Excited* (William Anthony, Bearport). Check the exact title on Amazon before publishing."),
 gen=dict(
  refs=["character-sheet.png","mama-ref.png","family-ref.png"],
  common=common(" and family-ref.png for the family (Papa Bear is a large friendly bear in a blue plaid shirt and brown trousers; keep him identical)", "The setting is Fennel's cozy cottage bedroom and living room (wooden bed, patchwork quilt, bedside lamp, window with floral curtains) at night, and a village fair with a Ferris wheel the next day. At night Fennel wears soft blue striped pajamas.", "The 'excitement' is a cloud of bouncy, glowing yellow sparks like little round springy balls of warm yellow light that bounce around (never a monster, no face); they get calmer and slower and finally rest like sleeping fireflies."),
  spread=SPREAD,
  scenes={
   "s01":"Early evening in the living room: Fennel jumping happily with his arms up beside a big picture-poster on the wall showing a Ferris wheel and balloons (drawn picture only, no writing), Mama Bear smiling; Fennel and Mama fully in the RIGHT half (Fennel about 62%, Mama about 84%); LEFT half: the wall with the poster and a cozy sofa.",
   "s02":"Fennel dancing on the wooden stairs with a small red wagon packed with a cap and a picnic basket beside him, fully in the LEFT half (about 27%); RIGHT half: the cozy hallway with a coat rack.",
   "s03":"Night in the bedroom: Fennel in blue pajamas sitting up in bed, fully in the RIGHT half (about 80%), looking at a single glowing yellow spark that pops into the air above his pillow; LEFT half: window with moon and stars.",
   "s04":"Many glowing yellow bouncy sparks bouncing around the bedroom, all fully in the RIGHT half (around 55% to 90%), with Fennel sitting up in bed amazed in the RIGHT half (about 75%); LEFT half: a calm moonlit window.",
   "s05":"A big glowing yellow bouncy ball of sparks filling the LEFT half, with Fennel bouncing on his bed with his arms up and a huge grin, fully in the LEFT half (about 27%); RIGHT half: the dim moonlit bedroom with a rug.",
   "s06":"Toys and a pillow flying through the air, Fennel standing in his bed with a worried tired face, fully in the RIGHT half (about 72%), a few yellow sparks bouncing around him; LEFT half: the bedroom door and a shelf.",
   "s07":"Papa Bear sitting on the edge of Fennel's bed next to Fennel, calm and kind, both fully in the LEFT half (Fennel about 18%, Papa about 38%), a few small yellow sparks floating; RIGHT half: moonlit window.",
   "s08":"Fennel wiggling and shaking his paws and knees happily on the rug, Papa Bear laughing and wiggling beside him, both fully in the RIGHT half (Fennel about 62%, Papa about 84%), a few yellow sparks flying off; LEFT half: the dim bedroom.",
   "s09":"Fennel taking a big breath with his tummy puffed out like a balloon, eyes closed, Papa Bear beside him doing the same, both fully in the LEFT half (Fennel about 18%, Papa about 38%), the yellow sparks slowing down; RIGHT half: moonlit window.",
   "s10":"Papa Bear and Fennel at the bedroom wall marking a countdown on a paper chart with little drawn stars (only star shapes, no writing), both fully in the RIGHT half (Fennel about 62%, Papa about 84%), a few small yellow sparks resting; LEFT half: the dim bedroom.",
   "s11":"Fennel asleep in bed with a smile, tucked in by Papa Bear who kisses his forehead, both fully in the LEFT half (Fennel about 22%, Papa about 40%); tiny yellow sparks rest quietly on the bedpost like sleeping fireflies, also in the left half; RIGHT half: calm moonlit window.",
   "s12":"The village fair the next day in golden light: Fennel, Mama Bear and Papa Bear walking happily with balloons, all fully in the RIGHT half (Fennel about 62%, Mama about 76%, Papa about 90%); LEFT half: the fair gate and a Ferris wheel with colorful stalls (no writing).",
   "cover":"SQUARE 1:1 front cover art. IMPORTANT LAYOUT: the top 38% of the image must be a calm soft dusky-blue night wall or sky (no objects) because a large title will be printed there. Scene in the lower 62%: Fennel in blue pajamas bouncing high on his bed with arms up and a huge smile, surrounded by many glowing bouncy yellow sparks, pillow and toys in the air. Fennel is the largest figure.",
  }))

# ---------------- Book 8: Purple Frustrated ----------------
BOOKS[8] = dict(
 folder="book8-fennel-purple-frustrated", title="Fennel and the Big Purple Frustrated", title_lines=["Fennel and","the Big Purple Frustrated"],
 subtitle="A story about feeling frustrated", subtitle_listing="A Story About Feeling Frustrated",
 story=[
  ["Fennel wanted to tie his shoes","all by himself — there was nothing to lose!"],
  ["He made a loop. He made a twirl.","The laces just flopped in a floppy swirl."],
  ["He pulled and he pulled. It came out a mess.","He tried once more. And once more. No success."],
  ["A purple coil popped out of his chest.","It wound itself tight. It would not rest."],
  ["Tighter and tighter, the coil went round.","\"I can't! I can't!\" he said with a frown."],
  ["He tossed down his shoe. It flew through the air.","Papa Bear came and sat on the stair."],
  ["\"Frustrated is hard,\" said Papa. \"I know.","Big things take time. We can take it slow.\""],
  ["\"First, PAUSE. Put your shoe down and shake.","Shake out your paws, for goodness' sake!\""],
  ["\"Next, TRY a new way. Make bunny ears two.","Cross them and tuck them. See what you can do.\""],
  ["\"Last, ASK for a hand. It's not giving in.","A helping paw is a place to begin.\""],
  ["Loop, swoop, pull — and the knot held tight!","The purple coil faded from sight."],
  ["Now when the purple gets tight and tough,","Fennel knows: Pause. Try. Ask. That's enough!"],
 ],
 steps_title="Fennel's 3 Patient Steps",
 steps=[["1. PAUSE","Stop. Put it down. Shake out your paws."],["2. TRY","Try a new way."],["3. ASK","Ask for a hand or a hint."]],
 steps_closing=["Frustrated is okay.","Hard things get easier."],
 note_lines=["Name the feeling: \"You feel frustrated.\"","Wait before helping. Let your child pause first.","Show a new way instead of doing it for them.","Praise effort, not only success."],
 cover_blurb=["Fennel wants to tie his shoes","all by himself. But the laces","will not cooperate, and a tight","Big Purple Frustrated grows.","","With a little help from Papa Bear,","Fennel learns three patient steps:","Pause. Try. Ask.","","A warm rhyming story for ages 3–6,","with a note for grown-ups."],
 listing=dict(
  description="""<p><b>Fennel wants to tie his shoes all by himself. But the laces flop, the loops slip, and a tight purple coil pops out of his chest.</b></p>
<p>The Big Purple Frustrated winds tighter and tighter with every try, until Papa Bear sits down beside him and shows him a better way.</p>
<p>With three patient steps — <b>Pause. Try. Ask.</b> — little readers learn that frustrated is okay, and that hard things get easier with practice and help.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A cozy read-aloud rhyme for ages 3–6, perfect for kids learning new skills</li>
<li>A kid-friendly image of frustration as a coiled purple spring that unwinds</li>
<li>Three easy steps children can copy: Pause, Try, Ask</li>
<li>A note for grown-ups with simple ways to coach through frustration</li>
<li>Soft watercolor-style illustrations</li>
</ul>
<p>Book 8 in the Fennel's Feelings series. A gentle story about tying shoes, trying again, and asking for help.</p>""",
  keywords=["children's book about frustration","learning to tie shoes book for kids","perseverance book for preschoolers","growth mindset picture book ages 3-6","social emotional learning book preschool","rhyming picture book bear dad","teach kids to ask for help"],
  categories=["Children's Books › Growing Up & Facts of Life › Emotions & Feelings","Children's Books › Growing Up & Facts of Life › Self-Esteem / Self-Reliance","Children's Books › Literature & Fiction › Animals › Bears"],
  notes="- No book titled \"Fennel and the Big Purple Frustrated\" or \"Big Purple Frustrated\" found.\n- Closest: *The Very Frustrated Monster*, *Fragan the Frustrated*, *Max and the Purple Worry* (a purple worry). Check the exact title on Amazon before publishing."),
 gen=dict(
  refs=["character-sheet.png","mama-ref.png","family-ref.png"],
  common=common(" and family-ref.png for the family (Papa Bear is a large friendly bear in a blue plaid shirt and brown trousers; keep him identical)", "The setting is the sunny wooden porch and front steps of Fennel's cottage with a bench, boots, coat hooks and a garden path.", "The 'frustration' is a coiled spring made of soft glowing purple light (like a spring or a slinky made of light) that winds tighter and tighter, then unwinds and fades into purple sparkles (never a monster, no face)."),
  spread=SPREAD,
  scenes={
   "s01":"Fennel sitting on the porch step holding one shoe with long laces in his paws, determined face, fully in the RIGHT half (about 72% of width); LEFT half: boots, coat hooks and a bench on the porch.",
   "s02":"Close view of Fennel making a loop with the laces, the laces flopping into a floppy swirl, fully in the LEFT half (about 27%), tongue out in concentration; RIGHT half: the porch rail and garden.",
   "s03":"Fennel pulling hard on the tangled laces in a messy knot, frowning, fully in the RIGHT half (about 72%); LEFT half: the porch with a basket of shoes.",
   "s04":"A coiled spring of glowing purple light pops out of Fennel's chest; Fennel looks down in surprise, fully in the LEFT half (about 27%); RIGHT half: the porch and garden.",
   "s05":"The purple spring has grown big and wound tight, spinning; Fennel with furrowed brows and shaking fists saying he cannot do it, fully in the RIGHT half (about 72%); LEFT half: the porch step.",
   "s06":"Fennel tossing a shoe up into the air (the shoe is mid-air), arms up in frustration, fully in the LEFT half (about 27%), the purple spring around him; Papa Bear in a blue plaid shirt arriving from the garden path, fully in the RIGHT half (about 75%).",
   "s07":"Papa Bear sitting on the porch stair next to Fennel, calm and kind, both fully in the LEFT half (Fennel about 18%, Papa about 38%), the purple spring a bit smaller; RIGHT half: the garden path and flowers.",
   "s08":"Fennel putting his shoe down and shaking out his paws, Papa Bear shaking his paws along with him, laughing, both fully in the RIGHT half (Fennel about 62%, Papa about 84%), the purple spring loosening; LEFT half: the porch with boots.",
   "s09":"Papa Bear showing Fennel how to make two bunny-ear loops with a large practice shoe, Fennel watching with curiosity, both fully in the LEFT half (Fennel about 18%, Papa about 38%); RIGHT half: the porch and garden.",
   "s10":"A close view of Papa Bear's big paw and Fennel's small paw together on the laces, both fully in the RIGHT half (about 55% to 90%), the purple spring unwinding into sparkles; LEFT half: the porch step and a shoe basket.",
   "s11":"Fennel proudly looking at his shoes with neat bows tied, big smile, fully in the LEFT half (about 27%), the purple spring fading into tiny purple sparkles in the air; RIGHT half: the sunny porch and garden.",
   "s12":"Fennel and Papa Bear walking together along the garden path in sunshine, Fennel's tied shoes visible, both fully in the RIGHT half (Fennel about 62%, Papa about 84%), a tiny purple sparkle in the air; LEFT half: the garden with flowers.",
   "cover":"SQUARE 1:1 front cover art. IMPORTANT LAYOUT: the top 38% of the image must be calm empty soft sky or wall (no objects) because a large title will be printed there. Scene in the lower 62%: Fennel sitting on the porch step with a scowling frustrated face holding a shoe with tangled laces, a big coiled spring of glowing purple light floating above him. Fennel is the largest figure.",
  }))

# ---------------- Book 9: Teal Lonely ----------------
BOOKS[9] = dict(
 folder="book9-fennel-teal-lonely", title="Fennel and the Big Teal Lonely", title_lines=["Fennel and","the Big Teal Lonely"],
 subtitle="A story about feeling lonely", subtitle_listing="A Story About Feeling Lonely",
 story=[
  ["Fennel went to the park one day,","ready to swing and slide and play."],
  ["But Clover was gone to see her gran.","And everyone else had a friend or a plan."],
  ["Ducks played tag. Squirrels shared a ball.","Fennel stood still. He played with no one at all."],
  ["A big teal bubble rose up from the ground.","It wrapped him in quiet, without a sound."],
  ["Everything sounded far, far away.","He sat on a bench. He had nobody to play."],
  ["Mama came over. \"Lonely is when","we'd love a friend, and we want one again.\""],
  ["\"First, LOOK around. Who is nearby?","Someone is there, with a kind little eye.\""],
  ["\"Next, say HELLO, with a smile that's warm.","A hello can melt a lonely storm.\""],
  ["\"Last, INVITE. Ask someone to play.","'Want to swing with me?' That's all you say.\""],
  ["Fennel looked. A hedgehog, small and shy,","was drawing in the dirt with a stick nearby."],
  ["\"Hello!\" said Fennel. \"Want to play?\"","\"Yes!\" said Pip. \"I hoped you'd say!\""],
  ["The teal bubble floated away, soft as a sigh.","Look. Hello. Invite. And a friend is nearby."],
 ],
 steps_title="Fennel's 3 Friend Steps",
 steps=[["1. LOOK","Look around for someone nearby."],["2. HELLO","Say hello with a smile."],["3. INVITE","Invite someone to play."]],
 steps_closing=["Lonely is okay.","A friend is near."],
 note_lines=["Name the feeling: \"You feel lonely.\"","Stay close and listen before fixing.","Role-play a hello and an invitation at home.","Arrange short playdates and celebrate every try."],
 cover_blurb=["Fennel's best friend is away.","Everyone at the park has a friend,","and a quiet Big Teal Lonely","wraps around him.","","With a little help from Mama Bear,","Fennel learns three friend steps:","Look. Hello. Invite.","","A warm rhyming story for ages 3–6,","with a note for grown-ups."],
 listing=dict(
  description="""<p><b>Fennel goes to the park, ready to swing and slide and play. But Clover is away, and everyone else already has a friend.</b></p>
<p>A big teal bubble rises up and wraps him in quiet. Everything sounds far away, until Mama Bear sits beside him and shows him how to find a friend.</p>
<p>With three friend steps — <b>Look. Hello. Invite.</b> — little readers learn that lonely is okay, and that a friend is nearby.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A cozy read-aloud rhyme for ages 3–6, perfect for playgrounds and new schools</li>
<li>A kid-friendly image of loneliness as a quiet teal bubble that floats away</li>
<li>Three easy steps children can copy: Look, Hello, Invite</li>
<li>A note for grown-ups with simple ways to help a lonely child make friends</li>
<li>Soft watercolor-style illustrations</li>
</ul>
<p>Book 9 in the Fennel's Feelings series. A gentle story about feeling alone and finding a friend.</p>""",
  keywords=["children's book about loneliness and friendship","book about making friends at the park","lonely child picture book ages 3-6","how to make a friend book for kids","social emotional learning book preschool","rhyming picture book bear friend","help kids feel less lonely"],
  categories=["Children's Books › Growing Up & Facts of Life › Emotions & Feelings","Children's Books › Growing Up & Facts of Life › Friendship","Children's Books › Literature & Fiction › Animals › Bears"],
  notes="- No book titled \"Fennel and the Big Teal Lonely\" or \"Big Teal Lonely\" found.\n- Closest: *My Lonely Book*, *I Feel Lonely* (DK), *When I Feel Lonely* (Britta Teckentrup). Check the exact title on Amazon before publishing."),
 gen=dict(
  refs=["character-sheet.png","mama-ref.png","pip-ref.png"],
  common=common(" and pip-ref.png for Pip, a small shy hedgehog with a cream face and soft brown spines in a little green vest (keep him identical)", "The setting is a sunny village park with swings, a slide, a pond with ducks and a big oak tree, with simple animal playmates (ducks, squirrels, rabbits).", "The 'loneliness' is a big, quiet, glass-like teal (blue-green) soap-bubble that rises around Fennel and mutes the world outside it, softly faded colors beyond the bubble (never a monster, no face)."),
  spread=SPREAD,
  scenes={
   "s01":"Fennel walking happily into the park with Mama Bear carrying a picnic basket, both fully in the RIGHT half (Fennel about 62%, Mama about 84%); LEFT half: swings and a slide in sunshine.",
   "s02":"Fennel standing at the park gate looking around hopefully; an empty bench with a small blue ball on it stands beside him, both fully in the LEFT half (Fennel about 27%); in the RIGHT half, far away, pairs of animals playing happily.",
   "s03":"Ducks playing tag and two squirrels sharing a ball, all fully in the RIGHT half (55% to 95%); Fennel standing alone and still, fully in the LEFT half (about 27%), looking sad.",
   "s04":"A big glass-like teal soap-bubble rising from the ground around Fennel, wrapping him in; Fennel inside it, fully in the LEFT half (about 27%), the world beyond slightly faded; RIGHT half: the park far away.",
   "s05":"Fennel sitting alone on a park bench inside a faint teal bubble, chin in his paws, fully in the RIGHT half (about 72%); LEFT half: empty swings and the pond far away in faded colors.",
   "s06":"Mama Bear sitting next to Fennel on the bench with an arm around him, both fully in the LEFT half (Fennel about 18%, Mama about 38%), the teal bubble around Fennel; RIGHT half: the park and the oak tree.",
   "s07":"Mama Bear pointing across the park while Fennel looks, a clearer thinner bubble around him, both fully in the RIGHT half (Fennel about 62%, Mama about 84%); LEFT half: the park path and flower beds.",
   "s08":"Fennel practicing a warm smile and a little wave hello, the teal bubble thinner and starting to shimmer, Mama Bear smiling beside him, both fully in the LEFT half (Fennel about 18%, Mama about 38%); RIGHT half: the pond with ducks.",
   "s09":"Fennel pointing hopefully at the swings as if inviting someone, Mama Bear smiling beside him, both fully in the RIGHT half (Fennel about 62%, Mama about 84%), the teal bubble almost gone; LEFT half: the swings.",
   "s10":"Fennel standing fully in the LEFT half (about 27%), looking toward the right with interest; Pip the small shy hedgehog in a green vest drawing in the dirt with a stick under the oak tree, fully in the RIGHT half (about 72%).",
   "s11":"Fennel waving hello to Pip the hedgehog and Pip smiling shyly, both fully in the RIGHT half (Fennel about 62%, Pip about 84%) near the swings; the bubble gone; LEFT half: the pond with ducks.",
   "s12":"Fennel and Pip on two swings laughing happily, both fully in the RIGHT half (Fennel about 62%, Pip about 84%); a teal bubble floats up softly into the sky like a soap bubble in the LEFT half; LEFT half: the park with the oak tree.",
   "cover":"SQUARE 1:1 front cover art. IMPORTANT LAYOUT: the top 38% of the image must be calm empty soft sky (no objects) because a large title will be printed there. Scene in the lower 62%: Fennel sitting alone on a park bench inside a big glass-like teal bubble, chin in his paws, looking wistful; far in the background faded animals playing together on swings. Fennel is the largest figure.",
  }))

# ---------------- Book 10: Rainbow of Feelings ----------------
BOOKS[10] = dict(
 folder="book10-fennel-rainbow-feelings", title="Fennel and the Big Rainbow of Feelings", title_lines=["Fennel and the Big","Rainbow of Feelings"],
 subtitle="A story about all our feelings", subtitle_listing="A Story About All Our Feelings",
 story=[
  ["Rain tapped the window. Rain tapped the door.","Fennel stayed in. What was in store?"],
  ["Mama set nine jars down in a row,","each with a small light, glowing aglow."],
  ["Red for his Mad, a balloon that grew.","Blue for his Sad, a puddle, too."],
  ["Gray for his Worry, a tangle of thread.","Green for his Jealous, a vine in his head."],
  ["Orange for Scared, a spark in the night.","Peach for his Shy, a cloud, soft and light."],
  ["Yellow for Excited, all bounce and zing.","Purple for Frustrated, a tight little spring."],
  ["Teal for his Lonely, a bubble so round.","Nine feelings, each one, he had found."],
  ["\"Feelings come, and feelings go.","Each one helps us learn and grow.\""],
  ["\"Feel it. Name it. Share it, too.","That's all you need. That's all you do.\""],
  ["He told Papa Bear, \"I felt scared last night.\"","\"Me too,\" said Papa, and they hugged tight."],
  ["The rain slowed down. The clouds rolled away.","The sun peeked out on a bright new day."],
  ["A rainbow stretched out, from jar to jar.","Every feeling is part of who we are."],
 ],
 steps_title="Fennel's 3 Feeling Steps",
 steps=[["1. FEEL IT","Notice what is inside."],["2. NAME IT","Say the feeling out loud."],["3. SHARE IT","Tell someone you trust."]],
 steps_closing=["All feelings are okay.","Every feeling is part of you."],
 note_lines=["Name the feeling: \"You feel ___.\"","Match each feeling to a color or a jar at home.","Say your own feelings out loud for your child.","Revisit books 1-9 for the feeling of the day."],
 cover_blurb=["It is a rainy day, and Mama Bear","brings out nine glowing jars.","Each one holds a feeling Fennel knows:","mad, sad, worried, jealous, scared,","shy, excited, frustrated and lonely.","","Feel it. Name it. Share it.","","A warm rhyming story for ages 3\u20136,","with a note for grown-ups."],
 listing=dict(
  description="""<p><b>It is a rainy day, and Mama Bear brings out nine glowing jars. Each one holds a feeling Fennel has met.</b></p>
<p>A red balloon for his Mad. A blue puddle for his Sad. A gray tangle of worry, a green vine of jealous, an orange spark of scared, a peach cloud of shy, yellow sparks of excited, a purple spring of frustrated, and a teal bubble of lonely.</p>
<p>With three feeling steps — <b>Feel it. Name it. Share it.</b> — little readers learn that every feeling is okay and part of who we are, until the rain stops and a rainbow stretches from jar to jar.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A cozy read-aloud rhyme for ages 3–6 that celebrates all nine feelings from the series</li>
<li>A kid-friendly image for every feeling, shown as a glowing jar</li>
<li>Three easy steps children can copy: Feel it, Name it, Share it</li>
<li>A note for grown-ups with simple ways to talk about feelings every day</li>
<li>Soft watercolor-style illustrations</li>
</ul>
<p>Book 10 in the Fennel's Feelings series. A gentle finale, and a great place for a new reader to begin.</p>""",
  keywords=["children's book about all feelings and emotions","emotions picture book for toddlers ages 3-6","social emotional learning book preschool","feelings jar book for kids","rhyming picture book bear family","rainy day picture book for kids","teach kids to name their feelings"],
  categories=["Children's Books › Growing Up & Facts of Life › Emotions & Feelings","Children's Books › Literature & Fiction › Animals › Bears","Children's Books › Growing Up & Facts of Life › Self-Esteem / Self-Reliance"],
  notes="- No book titled \"Fennel and the Big Rainbow of Feelings\" or \"Big Rainbow of Feelings\" found.\n- Closest: *My Rainbow of Feelings*, *The Rainbow in My Heart* (Jessica Urlichs), *The Great Big Book of Feelings*, *You Are a Burst of Color*. Check the exact title on Amazon before publishing."),
 gen=dict(
  refs=["character-sheet.png","mama-ref.png","family-ref.png","jars-ref.png"],
  common=common(" and family-ref.png for the family (Papa Bear: a large friendly bear in a blue plaid shirt and brown trousers; Baby Poppy: a tiny baby bear in a pink blanket with a pink bow; keep them identical) and jars-ref.png for the nine glowing glass jars with cork lids and their contents (red balloon, blue puddle, gray yarn tangle, green thorny vine, orange spark, peach wool cloud, yellow bouncy sparks, purple coiled spring, teal bubble; keep every jar's content identical and in the same order: top row red, blue, gray; middle row green, orange, peach; bottom row yellow, purple, teal)", "The setting is Fennel's cozy cottage living room on a rainy day: a big window with raindrops running down the glass, a green armchair, a wooden shelf, a warm lamp, rugs and cushions.", "The nine jars are small, glowing and gentle."),
  spread=SPREAD,
  scenes={
   "s01":"Rain on the big window in the LEFT half (about 30% of width); Fennel in his mustard sweater sitting on the window seat in the RIGHT half (about 72%), chin in his paws, watching the rain and looking a little bored.",
   "s02":"Mama Bear placing nine glowing jars in three rows of three on a wooden shelf, with the shelf and jars fully in the RIGHT half (55% to 95% of width) and Mama Bear standing at its left side, still inside the RIGHT half (about 55%); Fennel watching from the LEFT half (about 25%) with wide curious eyes.",
   "s03":"Fennel pointing at the top-left red balloon jar and the top-middle blue puddle jar of a shelf of nine jars, the two jars glowing a bit brighter than the rest; the whole shelf fully in the LEFT half (10% to 45%); Fennel standing beside it in the LEFT half; RIGHT half: the cozy room with the window and rain.",
   "s04":"Fennel looking at the gray yarn jar and the green vine jar of the shelf, both glowing slightly; the shelf (all nine jars) fully in the RIGHT half (55% to 95%); Fennel in the RIGHT half too (about 52%). LEFT half: the rainy window.",
   "s05":"Fennel gently touching the orange spark jar and the peach cloud jar, both glowing; shelf of nine jars fully in the LEFT half (10% to 45%); Fennel next to it in the LEFT half; RIGHT half: the cozy room with the green armchair.",
   "s06":"Fennel smiling at the yellow sparks jar and the purple spring jar, both glowing; the shelf fully in the RIGHT half (55% to 95%); Fennel in the RIGHT half (about 52%); LEFT half: the rainy window.",
   "s07":"Fennel holding up the teal bubble jar in both paws with a thoughtful smile; Mama Bear sitting beside him, both fully in the LEFT half (Fennel about 18%, Mama about 38%); the full shelf of nine glowing jars fully in the RIGHT half (60% to 95%).",
   "s08":"Mama Bear and Fennel sitting together on the green armchair, Mama's arm around him, looking at the shelf of nine jars glowing softly; both fully in the RIGHT half (Fennel about 62%, Mama about 84%); LEFT half: the rainy window.",
   "s09":"Fennel and Mama Bear holding the nine jars together in a gentle circle of light on the rug, the jars floating a little above the rug, both fully in the LEFT half (Fennel about 18%, Mama about 38%), jars arranged around them in the LEFT half; RIGHT half: the cozy room with a lamp.",
   "s10":"Papa Bear in his blue plaid shirt hugging Fennel tight in the green armchair, both fully in the RIGHT half (Fennel about 62%, Papa about 84%); a small orange-glowing jar on a side table beside them; LEFT half: the cozy room and window.",
   "s11":"The rain stopping: through the big window on the LEFT half (about 25%) a clearing sky, sunbeams and the first thin rainbow; Fennel, Mama Bear, Papa Bear and Baby Poppy (in a pink blanket) together on the rug, all fully in the RIGHT half (Fennel about 58%, Mama about 72%, Papa about 86%, Poppy held by Mama).",
   "s12":"A big joyful rainbow arching through the window and across the whole room, ending at the nine jars on the shelf in the RIGHT half (60% to 95%), the jars all glowing warmly in rainbow colors; Fennel standing in front of the shelf with his arms up happily, fully in the RIGHT half (about 55%); LEFT half: the sunny window and a wooden floor.",
   "cover":"SQUARE 1:1 front cover art. IMPORTANT LAYOUT: the top 38% of the image must be calm soft sky-blue wall or sky with a faint pale rainbow band (no objects) because a large title will be printed there. Scene in the lower 62%: Fennel in his mustard sweater and red scarf sitting happily on the floor in front of the wooden shelf of nine softly glowing jars, holding the middle jar with a big smile, the rainbow light touching the jars. Fennel is the largest figure.",
  }))

if __name__ == "__main__":
    import sys
    only = [int(x) for x in sys.argv[1:]]
    for n, b in BOOKS.items():
        if only and n not in only:
            continue
        d = os.path.join(ROOT, b["folder"])
        os.makedirs(os.path.join(d, "images"), exist_ok=True); os.makedirs(os.path.join(d, "kdp-upload"), exist_ok=True)
        spec = dict(n=n, title=b["title"], title_lines=b["title_lines"], subtitle=b["subtitle"], subtitle_listing=b["subtitle_listing"],
                    story=[[*u_pair(l, r), "top"] for l, r in b["story"]],
                    steps_title=Q(b["steps_title"]), steps=[[a, u(t)] for a, t in b["steps"]], steps_closing=[u(x) for x in b["steps_closing"]],
                    note_lines=[u(x) for x in b["note_lines"]], cover_blurb=[u(x) for x in b["cover_blurb"]],
                    listing=b["listing"], gen=b["gen"])
        json.dump(spec, open(os.path.join(d, "spec.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("spec", n, b["folder"])
