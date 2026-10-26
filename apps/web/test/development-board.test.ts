import {describe,it,expect} from 'vitest';
import {boardMoves} from '../components/development/board';
import {emptyData,iceScore,type Item} from '../components/development/model';
const item={id:'task',status:'todo',can_edit:true,can_manage:true,data:emptyData()} as Item;
const transitions={backlog:['todo','archived'],todo:['backlog','in_progress'],in_progress:['todo','review'],review:['in_progress','test'],test:['in_progress','done'],done:['backlog','archived']};
describe('delivery board transition permissions',()=>{
 it('uses server transitions and never skips review or test',()=>{expect(boardMoves(item,transitions)).toEqual(['backlog','in_progress']);expect(boardMoves({...item,status:'review'},transitions)).toEqual(['in_progress','test']);expect(boardMoves({...item,status:'done'},transitions)).toEqual(['backlog']);});
 it('limits authors to intake and disables read-only cards',()=>{expect(boardMoves({...item,can_manage:false},transitions)).toEqual(['backlog']);expect(boardMoves({...item,can_edit:false,can_manage:false},transitions)).toEqual([]);expect(boardMoves({...item,status:'review',can_manage:false},transitions)).toEqual([]);});
 it('keeps unrated ICE distinct from an assessed priority',()=>{expect(iceScore(emptyData())).toBeNull();expect(iceScore({ice:{impact:9,confidence:8,ease:7}})).toBe(504);});
});
