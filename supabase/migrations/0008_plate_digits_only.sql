-- Plates are stored bare from now on: digits only, no dashes or spaces.
-- Existing rows were written as "123-45-678" by the old OCR formatter, so
-- search and comparison would split across two spellings of the same plate.
update jobs set plate = regexp_replace(plate, '[^0-9]', '', 'g')
where plate ~ '[^0-9]';
