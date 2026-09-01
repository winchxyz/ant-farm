/*
   icons.js - the interface's drawn marks.

   Every icon in the toolbar used to be a Unicode character borrowed for its
   rough shape: a wolf spider was an asterisk, a woodlouse a half-filled
   circle, a cricket an arrow, and the four castes were the letters W F S Q.
   None of them depicted the thing they named, which is most of why the tray
   read as cheap - nobody had drawn anything.

   These are drawn: silhouettes on a 24x24 grid, stroke-only so they take
   whatever colour the CSS gives them, and legible at 24px because that is
   the size they are actually used at. The creatures are built from the
   feature that identifies the animal - a woodlouse's segmented shell, a
   cricket's folded hind leg, eight legs off a spider's two-part body - and
   the castes are told apart by proportion the way real ants are: the
   soldier by its head, the queen by her gaster.
*/
(function (AF) {
  'use strict';

  //  Common attributes. Stroke-only, round joins, and currentColor so a
  //  single CSS rule recolours every mark - including the disabled and
  //  selected states, which just change the colour of the button.
  var A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

  var P = {
    // ---- feed ----
    sugar: '<path d="M12 4.6 15.2 8 12 11.4 8.8 8Z"/>' +
      '<path d="M7.4 11.6 10.6 15 7.4 18.4 4.2 15Z"/>' +
      '<path d="M16.6 11.6 19.8 15 16.6 18.4 13.4 15Z"/>',
    water: '<path d="M12 3.4c-3.2 4.2-5 7-5 9.4a5 5 0 0 0 10 0c0-2.4-1.8-5.2-5-9.4Z"/>' +
      '<path d="M9.8 13.2a2.4 2.4 0 0 0 1.5 2.4"/>',

    // ---- the shovel ----
    shovel: '<path d="M12 3v9"/><path d="M9.4 3h5.2"/>' +
      '<path d="M8.2 12h7.6v2.6c0 3.2-1.9 5.6-3.8 6.8-1.9-1.2-3.8-3.6-3.8-6.8Z"/>',

    // ---- rooms ----
    tunnel: '<path d="M4 20V12a8 8 0 0 1 16 0v8"/>' +
      '<path d="M9 20v-7.4a3 3 0 0 1 6 0V20"/>',
    nursery: '<ellipse cx="9" cy="10" rx="3.1" ry="4.2"/>' +
      '<ellipse cx="15.4" cy="12.4" rx="2.7" ry="3.7"/>' +
      '<ellipse cx="11.4" cy="17.2" rx="2.4" ry="3.1"/>',
    pantry: '<path d="M5.4 11h13.2l-1.5 9H6.9Z"/>' +
      '<ellipse cx="9.4" cy="7.6" rx="2.5" ry="1.7" transform="rotate(-24 9.4 7.6)"/>' +
      '<ellipse cx="14.8" cy="8.2" rx="2.5" ry="1.7" transform="rotate(18 14.8 8.2)"/>',
    waste: '<path d="M3.6 9.4h16.8L16.2 20H7.8Z"/>' +
      '<circle cx="10.2" cy="5.6" r="1.7"/><circle cx="14.4" cy="6.4" r="1.3"/>',
    guard: '<path d="M6.4 4.2c4.2 2.2 6.6 5.4 6.6 9.4 0 2.8-1.4 5-3.6 6.2"/>' +
      '<path d="M17.6 4.2c-4.2 2.2-6.6 5.4-6.6 9.4 0 2.8 1.4 5 3.6 6.2"/>',
    cistern: '<path d="M4.6 9.6v4.6a7.4 7.4 0 0 0 14.8 0V9.6Z"/>' +
      '<path d="M4.6 13.2c1.9 0 1.9 1.6 3.7 1.6s1.9-1.6 3.7-1.6 1.9 1.6 3.7 1.6 1.9-1.6 3.7-1.6"/>' +
      '<path d="M12 3.2c-1.5 2-2.4 3.3-2.4 4.4a2.4 2.4 0 0 0 4.8 0c0-1.1-.9-2.4-2.4-4.4Z"/>',
    throne: '<path d="M5 19h14"/><path d="M6.4 19V9.4l3.4 2.6L12 6.6l2.2 5.4 3.4-2.6V19"/>',
    fungus: '<path d="M4.4 11.6a7.6 7.6 0 0 1 15.2 0Z"/><path d="M12 11.6V20"/>' +
      '<path d="M12 16.6c2.2 0 3.4-1.2 3.4-3"/>',
    lab: '<path d="M10 3v6.4L5.2 18a2.2 2.2 0 0 0 1.9 3.2h9.8A2.2 2.2 0 0 0 18.8 18L14 9.4V3"/>' +
      '<path d="M8.6 3h6.8"/><path d="M7.6 15h8.8"/>',
    gate: '<path d="M4 20V8.6L12 4l8 4.6V20"/><path d="M9.4 20v-6.4h5.2V20"/>',

    // ---- the bestiary ----
    woodlouse: '<path d="M4.4 12c0-3.6 3.4-5.6 7.6-5.6s7.6 2 7.6 5.6-3.4 5.6-7.6 5.6S4.4 15.6 4.4 12Z"/>' +
      '<path d="M8.6 7.2v9.6M11.4 6.5v11M14.2 7.2v9.6"/>' +
      '<path d="M6.6 17.4l-1.2 2.2M10 18.1l-.7 2.3M14 18.1l.7 2.3M17.4 17.4l1.2 2.2"/>',
    cricket: '<ellipse cx="11" cy="13.4" rx="5.4" ry="3.2" transform="rotate(-12 11 13.4)"/>' +
      '<circle cx="17" cy="10.4" r="2"/><path d="M18.4 8.8 21 5.6M18.9 9.9l2.9-1.6"/>' +
      '<path d="M9.6 11 6.2 4.8 3.4 12.2l4 2"/>' +
      '<path d="M8.6 16.4l-1.4 3.4M12.6 16.6l.6 3.2"/>',
    beetle: '<ellipse cx="12" cy="13.6" rx="5.2" ry="6.4"/><path d="M12 7.4v12.6"/>' +
      '<ellipse cx="12" cy="6.2" rx="2.6" ry="1.9"/>' +
      '<path d="M10.6 4.6 9.4 2.8M13.4 4.6l1.2-1.8"/>' +
      '<path d="M6.9 9.6 3.4 7.8M6.9 13.6H3.2M7.3 17.4l-3.2 2.1' +
      'M17.1 9.6l3.5-1.8M17.1 13.6h3.7M16.7 17.4l3.2 2.1"/>',
    spider: '<ellipse cx="12" cy="14.4" rx="4" ry="4.4"/><ellipse cx="12" cy="9" rx="2.5" ry="2.2"/>' +
      '<path d="M9.8 8 5.6 4.8 3 7.4M9.6 10.4 4.4 9.6 2.6 12.6' +
      'M9.8 12.8 4.6 14.2 3.4 17.6M10.4 15.4 6.4 18.4 6 21.4"/>' +
      '<path d="M14.2 8l4.2-3.2L21 7.4M14.4 10.4l5.2-.8 1.8 3' +
      'M14.2 12.8l5.2 1.4 1.2 3.4M13.6 15.4l4 3 .4 3"/>',
    centipede: '<path d="M3.4 8.6c3 0 3-3 6-3s3 3 6 3 3-3 5.2-2.4"/>' +
      '<path d="M3.4 14.4c3 0 3-3 6-3s3 3 6 3 3-3 5.2-2.4"/>' +
      '<path d="M4.6 6.2 3.4 3.8M7.6 5.9 7 3.4M10.8 6.6l.6-2.6M14 8l.8-2.4M17.2 7.6l1.4-2.2"/>' +
      '<path d="M4.6 16.6 3.6 19M7.8 16.1 7.4 18.8M11 17.2l.4 2.6M14.2 18.4l.8 2.4M17.4 17.2l1.4 2.2"/>',

    // ---- castes, told apart by proportion ----
    worker: '<circle cx="16.6" cy="11" r="2.6"/><ellipse cx="11.6" cy="11.6" rx="2.4" ry="2"/>' +
      '<ellipse cx="6.2" cy="12" rx="3.6" ry="3"/>' +
      '<path d="M18.4 9 21 6.6M18.8 12.6l2.6.6"/>' +
      '<path d="M12.6 9.8 13.6 6.4M11.2 9.7 9.6 6.6M12.8 13.6l1.6 3M10.6 13.5 9 16.8"/>',
    forager: '<circle cx="17" cy="11.4" r="2.2"/><ellipse cx="12.4" cy="11.8" rx="2.2" ry="1.7"/>' +
      '<ellipse cx="7.4" cy="12.2" rx="3.2" ry="2.4"/>' +
      '<path d="M18.6 9.6 21.4 6.2M19 12.8l2.6.2"/>' +
      '<path d="M13.4 10.2 15 5.8M11.6 10.1 9.4 5.6M13.6 13.6l2 4.4M10.8 13.5 8.6 18.2"/>',
    soldier: '<circle cx="16.4" cy="11" r="4"/>' +
      '<path d="M19.4 8.2c1.6-.6 2.6-1.6 3-2.8M19.4 13.8c1.6.6 2.6 1.6 3 2.8"/>' +
      '<ellipse cx="10.4" cy="11.6" rx="2.2" ry="1.9"/><ellipse cx="5.6" cy="12" rx="3.4" ry="2.8"/>' +
      '<path d="M11.4 9.9 12.4 6.6M9.6 9.8 8 6.8M11.6 13.4l1.4 3M8.6 13.5 7 16.8"/>',
    queen: '<circle cx="18.4" cy="10.6" r="2.2"/><ellipse cx="14.2" cy="11.4" rx="2.2" ry="1.9"/>' +
      '<ellipse cx="7.4" cy="12.6" rx="5.6" ry="4.4"/>' +
      '<path d="M11.2 8.8c-1.6-2.6-4.6-4-7.4-3.4"/>' +
      '<path d="M20 8.8 22.2 6.6M20.2 12.4l2.2.6"/>' +
      '<path d="M14.8 9.4 15.8 6.4M13.2 9.5 11.8 6.8"/>',
    nurse: '<circle cx="17" cy="11" r="2.4"/><ellipse cx="12.2" cy="11.6" rx="2.2" ry="1.9"/>' +
      '<ellipse cx="7" cy="12" rx="3.4" ry="2.8"/>' +
      '<ellipse cx="6.4" cy="18.6" rx="2.4" ry="3" transform="rotate(-22 6.4 18.6)"/>' +
      '<path d="M18.8 9.2 21.2 6.8M19 12.6l2.4.6"/>' +
      '<path d="M13.2 9.8 14 6.6M11.4 9.8 9.8 6.8"/>',
    cleaner: '<circle cx="17" cy="11" r="2.4"/><ellipse cx="12.2" cy="11.6" rx="2.2" ry="1.9"/>' +
      '<ellipse cx="7" cy="12" rx="3.4" ry="2.8"/>' +
      '<path d="M18.8 9.2 21.2 6.8M19 12.6l2.4.6"/>' +
      '<path d="M4 17.6 2.4 21M7 18.2l-.6 3M10 17.8l1 3.1"/>',
    scout: '<circle cx="17.4" cy="11.4" r="2.1"/><ellipse cx="12.8" cy="11.8" rx="2.1" ry="1.6"/>' +
      '<ellipse cx="7.8" cy="12.2" rx="3" ry="2.3"/>' +
      '<path d="M18.9 9.4 22 5.6M19.2 12.8l2.8 0"/>' +
      '<path d="M13.8 10.2 15.8 5.4M12 10.1 9.6 5.2M14 13.6l2.4 4.8M11.2 13.5 8.6 18.6"/>',
    major: '<circle cx="16" cy="11" r="4.6"/>' +
      '<path d="M19.4 7.6c1.8-.8 3-2 3.4-3.4M19.4 14.4c1.8.8 3 2 3.4 3.4"/>' +
      '<ellipse cx="9.6" cy="11.6" rx="2.2" ry="1.9"/><ellipse cx="4.8" cy="12" rx="3.4" ry="2.9"/>' +
      '<path d="M10.6 9.8 11.6 6.4M8.8 9.8 7.2 6.6M10.8 13.4l1.4 3M7.8 13.5 6.2 16.8"/>',
    alate: '<circle cx="17" cy="11.6" r="2.2"/><ellipse cx="12.4" cy="12" rx="2.2" ry="1.8"/>' +
      '<ellipse cx="7.2" cy="12.4" rx="3.4" ry="2.7"/>' +
      '<path d="M11.6 10.2c-1.4-3.2-4.4-5-8-4.6M13 10.4c-.6-3.4-2.8-5.6-6-6.2"/>' +
      '<path d="M18.6 9.8 21.2 7.4M19 13l2.4.4"/>'
  };

  //  <svg> wrapper. aria-hidden because every button already carries its
  //  name as text - a screen reader that also announced the icon would say
  //  everything twice.
  AF.icon = function (key) {
    var d = P[key];
    if (!d) return '';
    return '<svg class="ic" ' + A + ' aria-hidden="true">' + d + '</svg>';
  };

  AF.hasIcon = function (key) { return !!P[key]; };

  //  Rooms are chosen by chamber type, so the toolbar needs the type -> key
  //  table. Anything missing falls back to the tunnel mark rather than
  //  drawing nothing.
  AF.ICON_CHAMBER = {
    0: 'tunnel', 1: 'gate', 2: 'throne', 3: 'nursery', 4: 'pantry',
    5: 'waste', 6: 'fungus', 7: 'guard', 8: 'cistern', 9: 'lab',
    10: 'gate', 11: 'cistern'
  };

})(window.AF = window.AF || {});
