import {describe,it,expect} from 'vitest';
import {parseTelegram,fxQuery} from '../../src/modules/market/service.js';
describe('public market data parsing',()=>{
 it('keeps only matching public posts, plain short headlines and source dates',()=>{const post='<div data-post="mono_up/10"><div class="tgme_widget_message_text js-message_text">Regulation &amp; payments. '+Array(40).fill('word').join(' ')+'<script>steal()</script></div><time datetime="2026-10-22T12:00:00Z"></time></div>';const r=parseTelegram(post+post+'<div data-post="foreign/11">','mono_up');expect(r).toHaveLength(1);expect(r[0]!.url).toBe('https://t.me/mono_up/10');expect(r[0]!.title.split(/\s+/).length).toBeLessThanOrEqual(20);expect(r[0]!.title).not.toContain('steal');expect(r[0]!.published_at).toBe('2026-10-22T12:00:00.000Z')});
 it('rejects malformed timestamps and currency URLs',()=>{expect(parseTelegram('<div data-post="mono_up/2"><div class="tgme_widget_message_text">Missing timestamp should not create a post at the current time</div>','mono_up')).toEqual([]);expect(fxQuery.safeParse({base:'https://internal'}).success).toBe(false)});
});
