--    Copyright (C) 2011-2013 University of Southampton
--    Copyright (C) 2011-2013 Daniel Alexander Smith
--    Copyright (C) 2011-2013 Max Van Kleek
--    Copyright (C) 2011-2013 Nigel R. Shadbolt
--
--    This program is free software: you can redistribute it and/or modify
--    it under the terms of the GNU Affero General Public License, version 3,
--    as published by the Free Software Foundation.
--
--    This program is distributed in the hope that it will be useful,
--    but WITHOUT ANY WARRANTY; without even the implied warranty of
--    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
--    GNU Affero General Public License for more details.
--
--    You should have received a copy of the GNU Affero General Public License
--    along with this program.  If not, see <http://www.gnu.org/licenses/>.

CREATE INDEX idx_vers_diffs
  ON wb_vers_diffs
  USING btree
  (version, id_diff);

CREATE INDEX idx_id_latest_subject
  ON wb_latest_subjects
  USING btree
  (id_subject);

CREATE INDEX idx_id_string
  ON wb_strings
  USING btree
  (id_string, string);

CREATE INDEX idx_string_id
  ON wb_strings
  USING btree
  (string, id_string);


CREATE INDEX idx_otv
  ON wb_objects
  USING btree
  (id_object, obj_type, obj_value);

CREATE INDEX idx_o_all
  ON wb_objects
  USING btree
  (obj_type, obj_value, obj_lang, obj_datatype, id_object);

CREATE INDEX idx_vt
  ON wb_objects
  USING btree
  (obj_type);

CREATE INDEX idx_vo
  ON wb_objects
  USING btree
  (obj_value);

CREATE INDEX idx_vl
  ON wb_objects
  USING btree
  (obj_lang);

CREATE INDEX idx_vd
  ON wb_objects
  USING btree
  (obj_datatype);

CREATE INDEX idx_ver
  ON wb_latest_vers
  USING btree
  (triple, triple_order);


CREATE INDEX idx_triple
  ON wb_triples
  USING btree
  (id_triple, subject, predicate, object);

CREATE INDEX idx_predicate
  ON wb_triples
  USING btree
  (predicate, id_triple);

CREATE INDEX idx_subject
  ON wb_triples
  USING btree
  (subject, id_triple);

CREATE INDEX idx_object
  ON wb_triples
  USING btree
  (object, id_triple);


