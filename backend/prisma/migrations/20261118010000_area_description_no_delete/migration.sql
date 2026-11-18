-- Descripción del área: qué proyectos corresponden a ella.
ALTER TABLE "Area" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';

UPDATE "Area" SET "description" = 'Proyectos de física: óptica, mecánica, sismología, instrumentación y mediciones.' WHERE "name" = 'Física' AND "description" = '';
UPDATE "Area" SET "description" = 'Proyectos de química: síntesis, análisis de materiales y procesos de laboratorio.' WHERE "name" = 'Química' AND "description" = '';
UPDATE "Area" SET "description" = 'Proyectos de biología: genómica, ecología, microbiología y estudios de organismos vivos.' WHERE "name" = 'Biología' AND "description" = '';

-- Áreas y proyectos no se borran, ni siquiera con SQL directo: se desactivan.
-- Así se conserva siempre el historial de los proyectos y de lo que se les causó y pagó.
CREATE TRIGGER "area_no_delete" BEFORE DELETE ON "Area"
BEGIN
    SELECT RAISE(ABORT, 'Las áreas no se borran: se desactivan');
END;

CREATE TRIGGER "project_no_delete" BEFORE DELETE ON "Project"
BEGIN
    SELECT RAISE(ABORT, 'Los proyectos no se borran: se desactivan');
END;
