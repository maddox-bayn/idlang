import json
from pathlib import Path
import tempfile
import unittest
from prepare_parallel import aligned, clean, index_data, load_json, split_rows

class PreparationTests(unittest.TestCase):
    def test_reordering_and_missing_id_do_not_shift(self):
        en = index_data([{'id': 'a', 'english': 'first'}, {'id': 'b', 'english': 'second'}], 'english')
        idu = index_data([{'id': 'b', 'idoma': 'ɛcɛ'}, {'id': 'c', 'idoma': 'ɔla'}], 'idoma')
        rows, _, drops = aligned(en, idu)
        self.assertEqual([(r['reference'],r['eng_Latn'],r['idu_Latn']) for r in rows], [('b','second','ɛcɛ')])
        self.assertEqual(drops['missing_counterpart'], 2)

    def test_duplicate_ids_are_all_quarantined(self):
        d = index_data([{'id':'a','text':'one'}, {'id':'a','text':'two'}, {'id':'a','text':'three'}], 'english')
        self.assertNotIn('a', d[0]); self.assertIn('a', d[1])

    def test_corrupt_reference_is_not_paired(self):
        d = index_data([{'reference':'GEN.1.1','chapter':2,'english':'first'}], 'english')
        self.assertIn('GEN.1.1',d[1])

    def test_cleanup_keeps_diacritics(self):
        self.assertEqual(clean('<b>Ɔwɔicō</b> &amp; ɛcɛ'), 'Ɔwɔicō & ɛcɛ')
        for text in (None,'N/A','<i></i>','[MISSING]','ụụ','broken\ufffd'):
            self.assertIsNone(clean(text))

    def test_load_bom_and_reject_duplicate_object_keys(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'input.json';p.write_bytes(json.dumps({'a':'ɛcɛ'},ensure_ascii=False).encode('utf-16'))
            self.assertEqual(load_json(p), {'a':'ɛcɛ'})
            p.write_text('{"a":"first","a":"second"}')
            with self.assertRaises(ValueError): load_json(p)

    def test_group_stratification_reproducible_no_either_language_leak(self):
        rows=[{'reference':str(i),'eng_Latn':f'english {i}', 'idu_Latn':f'idoma {i}'} for i in range(100)]
        rows[1]['eng_Latn']=rows[0]['eng_Latn']
        rows[2]['idu_Latn']=rows[1]['idu_Latn']
        a,_=split_rows(rows);b,_=split_rows(rows)
        self.assertEqual(a,b);self.assertEqual(sum(map(len,a)),100)
        owner={r['reference']:i for i,s in enumerate(a) for r in s}
        self.assertEqual(owner['0'],owner['1']);self.assertEqual(owner['1'],owner['2'])

    def test_keyed_objects_and_positional_holes(self):
        a=index_data({'a':'hello','b':None},'english')
        b=index_data({'b':'ɛcɛ','a':'ɔla'},'idoma')
        self.assertEqual(len(aligned(a,b)[0]),1)
        a=index_data(['hello',None,'world'],'english')
        self.assertTrue(a[2]);self.assertIsNone(a[0]['1']);self.assertEqual(a[0]['2'],'world')

if __name__=='__main__': unittest.main()
